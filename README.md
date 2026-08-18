# claude-bugbot

A Telegram bot: report a bug, Claude Code fixes it via GitHub Actions, sends a
screenshot of the live app for approval, and with a button tap opens a PR and
sends you the link.

```
Telegram → Cloudflare Worker → GitHub Actions (workflow_dispatch)
                                   ├─ Claude Code fixes it, opens a branch
                                   ├─ runs the app + takes a screenshot (Playwright)
                                   └─ sends screenshot + approve/reject buttons to Telegram
                                        │
                                   (approve) → Worker → GitHub Actions → opens PR → sends link
```

## One-Time Global Setup

### 1. GitHub Personal Access Token

The Worker needs a PAT to trigger workflows in your repos.

1. https://github.com/settings/tokens?type=beta → **Generate new token** (Fine-grained)
2. Repository access: **All repositories** (so it works on any future project)
3. Permissions: **Actions: Read and write**, **Contents: Read and write**
4. Save the token — you'll need it in step 3.

### 2. Create a KV Namespace

Inside `worker/`:

```bash
npm install
npx wrangler login
npx wrangler kv namespace create BUGBOT_KV
```

This returns an `id` — paste it into `worker/wrangler.toml` in place of
`REPLACE_WITH_KV_NAMESPACE_ID`.

### 3. Set Worker Secrets

```bash
cd worker
npx wrangler secret put TELEGRAM_BOT_TOKEN        # the token from BotFather
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET    # random string you make up (openssl rand -hex 20)
npx wrangler secret put GITHUB_TOKEN               # the PAT from step 1
npx wrangler secret put ALLOWED_CHAT_ID            # your Chat ID from @userinfobot
npx wrangler secret put BUGBOT_INTERNAL_SECRET     # another random string (openssl rand -hex 20)
```

### 4. Deploy

```bash
npx wrangler deploy
```

This returns a URL like `https://claude-bugbot.<your-subdomain>.workers.dev` —
save it.

### 5. Register the Webhook with Telegram

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://claude-bugbot.<your-subdomain>.workers.dev/telegram-webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

(The same `TELEGRAM_WEBHOOK_SECRET` you set in step 3.)

### 6. Claude Code OAuth Token (one-time, project-independent)

```bash
claude setup-token
```

Save the token that gets printed — it will be used across all repos.

### 7. Push This Repo to GitHub

**This repo must be public** (or private with the right permissions) so that
`uses: BenEliyahu/claude-bugbot/.github/workflows/...@main` works from any of
your other repos.

```bash
gh repo create claude-bugbot --public --source=. --remote=origin --push
```

---

## Adding a New Project (every time you create a new repo)

```bash
cp scripts/.env.bugbot.example scripts/.env.bugbot
# fill in: CLAUDE_CODE_OAUTH_TOKEN, TELEGRAM_BOT_TOKEN, BUGBOT_INTERNAL_SECRET, BUGBOT_WORKER_URL

./scripts/setup-new-repo.sh /path/to/new/project
```

The script copies over the required workflow and script files, and sets up
the secrets in the new repo via `gh secret set`. Afterward — check the
`dev_url`/`dev_command` in `.github/workflows/bugbot.yml` (default: `npm run
dev` on port 3000), add `playwright` and `wait-on` as devDependencies, and
push.

## Usage

In Telegram, chat with the bot:

```
/fix BenEliyahu/Portfolio: the "Contact" button doesn't respond to taps on mobile
```

The bot will reply that it's starting, and within a few minutes will send a
screenshot of the app with the change applied, plus ✅/❌ buttons. Approving
opens a PR and sends the link; rejecting deletes the branch.

## Known Limitations (MVP)

- Supports Node/Next.js projects that run with `npm run dev` on a fixed port.
  For other project types you'll need to adjust `dev_url`/`dev_command`.
- There's no validation that Claude's diff is safe (e.g. no linter/test run) —
  consider adding an `npm run lint && npm test` step before sending the
  screenshot.
- Every new repo requires setting up 4 secrets separately (GitHub personal
  accounts don't have org-level secrets) — `setup-new-repo.sh` handles this
  in one command.
