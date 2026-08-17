// Registers the pending fix with the Cloudflare Worker (to get a short id for
// the Telegram callback_data, which is capped at 64 bytes) and sends the
// screenshot to Telegram with Approve/Reject inline buttons.
//
// Required env vars: BUGBOT_WORKER_URL, BUGBOT_INTERNAL_SECRET,
// TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, BRANCH, BUG_DESCRIPTION, REPO
import { readFile } from "node:fs/promises";

const {
  BUGBOT_WORKER_URL,
  BUGBOT_INTERNAL_SECRET,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  BRANCH,
  BUG_DESCRIPTION,
  REPO, // "owner/repo"
} = process.env;

const [owner, repo] = REPO.split("/");

const registerRes = await fetch(`${BUGBOT_WORKER_URL}/register-approval`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${BUGBOT_INTERNAL_SECRET}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ owner, repo, branch: BRANCH, description: BUG_DESCRIPTION }),
});

if (!registerRes.ok) {
  throw new Error(`register-approval failed: ${registerRes.status} ${await registerRes.text()}`);
}

const { id } = await registerRes.json();

const imageBuffer = await readFile("screenshot.png");
const form = new FormData();
form.append("chat_id", TELEGRAM_CHAT_ID);
form.append(
  "caption",
  `🔧 תיקון מוכן ל-*${REPO}*\n\n${BUG_DESCRIPTION}\n\nענף: \`${BRANCH}\``
);
form.append("parse_mode", "Markdown");
form.append(
  "reply_markup",
  JSON.stringify({
    inline_keyboard: [
      [
        { text: "✅ אשר ותפתח PR", callback_data: `appr:${id}` },
        { text: "❌ דחה", callback_data: `rej:${id}` },
      ],
    ],
  })
);
form.append("photo", new Blob([imageBuffer], { type: "image/png" }), "screenshot.png");

const sendRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
  method: "POST",
  body: form,
});

if (!sendRes.ok) {
  throw new Error(`sendPhoto failed: ${sendRes.status} ${await sendRes.text()}`);
}

console.log("Notified Telegram, pending id:", id);
