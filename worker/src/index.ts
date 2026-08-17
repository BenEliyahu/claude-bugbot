/**
 * claude-bugbot Telegram webhook worker.
 *
 * Receives Telegram updates, and:
 *  - on "/fix owner/repo: description" from the allowed chat, triggers the
 *    "bugbot.yml" workflow_dispatch in the target repo.
 *  - on an inline-keyboard callback (Approve/Reject), looks up the pending
 *    fix in KV and triggers either the PR-creation workflow or a cleanup.
 *
 * Also exposes POST /register-approval, called by the GitHub Actions workflow
 * once a fix branch + screenshot are ready, to stash the {owner, repo, branch}
 * behind a short id (Telegram callback_data is capped at 64 bytes).
 */

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  GITHUB_TOKEN: string;
  ALLOWED_CHAT_ID: string;
  BUGBOT_INTERNAL_SECRET: string;
  BUGBOT_KV: KVNamespace;
}

const FIX_COMMAND_RE = /^\/fix\s+([\w.-]+\/[\w.-]+)\s*:?\s*([\s\S]+)$/i;

async function telegram(env: Env, method: string, body: unknown): Promise<Response> {
  return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function dispatchWorkflow(
  env: Env,
  owner: string,
  repo: string,
  workflowFile: string,
  inputs: Record<string, string>
): Promise<Response> {
  return fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "claude-bugbot-worker",
      },
      body: JSON.stringify({ ref: "main", inputs }),
    }
  );
}

function shortId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

async function handleMessage(env: Env, message: any): Promise<void> {
  const chatId = String(message.chat?.id ?? "");
  if (chatId !== env.ALLOWED_CHAT_ID) return; // silently ignore anyone else

  const text: string = message.text ?? "";
  const match = text.match(FIX_COMMAND_RE);

  if (!match) {
    await telegram(env, "sendMessage", {
      chat_id: chatId,
      text:
        "לא הבנתי. שלח בפורמט:\n/fix owner/repo: תיאור הבאג\n\nלדוגמה:\n/fix BenEliyahu/Portfolio: הכפתור לא מגיב במובייל",
    });
    return;
  }

  const [, ownerRepo, bugDescription] = match;
  const [owner, repo] = ownerRepo.split("/");

  const dispatchRes = await dispatchWorkflow(env, owner, repo, "bugbot.yml", {
    bug_description: bugDescription.trim(),
    telegram_chat_id: chatId,
  });

  if (dispatchRes.ok) {
    await telegram(env, "sendMessage", {
      chat_id: chatId,
      text: `🔧 מתחיל לעבוד על *${ownerRepo}*:\n${bugDescription.trim()}\n\nאשלח סקרינשוט לאישור כשיהיה מוכן.`,
      parse_mode: "Markdown",
    });
  } else {
    const errText = await dispatchRes.text();
    await telegram(env, "sendMessage", {
      chat_id: chatId,
      text: `❌ לא הצלחתי להפעיל את ה-workflow ב-${ownerRepo}.\nודא שקובץ .github/workflows/bugbot.yml קיים שם.\n\n${errText.slice(0, 300)}`,
    });
  }
}

async function handleCallback(env: Env, callbackQuery: any): Promise<void> {
  const chatId = String(callbackQuery.from?.id ?? "");
  const callbackId = callbackQuery.id;
  if (chatId !== env.ALLOWED_CHAT_ID) {
    await telegram(env, "answerCallbackQuery", { callback_query_id: callbackId });
    return;
  }

  const data: string = callbackQuery.data ?? "";
  const [action, id] = data.split(":");
  const messageId = callbackQuery.message?.message_id;

  const stored = await env.BUGBOT_KV.get(`pending:${id}`, "json") as
    | { owner: string; repo: string; branch: string; description: string }
    | null;

  if (!stored) {
    await telegram(env, "answerCallbackQuery", {
      callback_query_id: callbackId,
      text: "הבקשה הזו כבר לא תקפה.",
    });
    return;
  }

  if (action === "appr") {
    const res = await dispatchWorkflow(env, stored.owner, stored.repo, "bugbot-create-pr.yml", {
      branch: stored.branch,
      description: stored.description,
      telegram_chat_id: chatId,
    });
    if (res.ok) {
      await telegram(env, "answerCallbackQuery", { callback_query_id: callbackId, text: "מאושר! פותח PR..." });
      if (messageId) {
        await telegram(env, "editMessageCaption", {
          chat_id: chatId,
          message_id: messageId,
          caption: `✅ אושר — פותח PR מ-${stored.branch}...`,
        });
      }
      await env.BUGBOT_KV.delete(`pending:${id}`);
    } else {
      const errText = (await res.text()).slice(0, 300);
      await telegram(env, "answerCallbackQuery", {
        callback_query_id: callbackId,
        text: "ההפעלה נכשלה, נסה שוב בעוד רגע",
        show_alert: true,
      });
      await telegram(env, "sendMessage", {
        chat_id: chatId,
        text: `❌ הפעלת bugbot-create-pr נכשלה (${res.status}). אפשר ללחוץ שוב על הכפתור לנסות שוב.\n\n${errText}`,
      });
      // Keep the KV entry so the same button click can be retried.
    }
  } else if (action === "rej") {
    const res = await dispatchWorkflow(env, stored.owner, stored.repo, "bugbot-cleanup.yml", {
      branch: stored.branch,
    });
    if (res.ok) {
      await telegram(env, "answerCallbackQuery", { callback_query_id: callbackId, text: "בוטל." });
      if (messageId) {
        await telegram(env, "editMessageCaption", {
          chat_id: chatId,
          message_id: messageId,
          caption: `❌ נדחה — הענף ${stored.branch} יימחק.`,
        });
      }
      await env.BUGBOT_KV.delete(`pending:${id}`);
    } else {
      await telegram(env, "answerCallbackQuery", {
        callback_query_id: callbackId,
        text: "הביטול נכשל, נסה שוב בעוד רגע",
        show_alert: true,
      });
      // Keep the KV entry so the same button click can be retried.
    }
  }
}

async function handleRegisterApproval(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${env.BUGBOT_INTERNAL_SECRET}`) {
    return new Response("unauthorized", { status: 401 });
  }

  const body = await request.json() as {
    owner: string;
    repo: string;
    branch: string;
    description: string;
  };

  const id = shortId();
  await env.BUGBOT_KV.put(`pending:${id}`, JSON.stringify(body), {
    expirationTtl: 60 * 60 * 24 * 3, // 3 days
  });

  return new Response(JSON.stringify({ id }), {
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/register-approval" && request.method === "POST") {
      return handleRegisterApproval(request, env);
    }

    if (url.pathname === "/telegram-webhook" && request.method === "POST") {
      const secret = request.headers.get("x-telegram-bot-api-secret-token");
      if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("unauthorized", { status: 401 });
      }

      const update = await request.json() as any;

      if (update.message) {
        await handleMessage(env, update.message);
      } else if (update.callback_query) {
        await handleCallback(env, update.callback_query);
      }

      return new Response("ok");
    }

    return new Response("claude-bugbot worker", { status: 200 });
  },
};
