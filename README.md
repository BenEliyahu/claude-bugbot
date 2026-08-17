# claude-bugbot

בוט טלגרם: מדווחים על באג, Claude Code מתקן אותו ב-GitHub Actions, שולח סקרינשוט
של האפליקציה החיה לאישור, ובלחיצת כפתור פותח PR ושולח לינק.

```
Telegram → Cloudflare Worker → GitHub Actions (workflow_dispatch)
                                   ├─ Claude Code מתקן, פותח branch
                                   ├─ מריץ את האפליקציה + סקרינשוט (Playwright)
                                   └─ שולח סקרינשוט + כפתורי אישור/דחייה לטלגרם
                                        │
                                   (אישור) → Worker → GitHub Actions → פותח PR → שולח לינק
```

## התקנה חד-פעמית (global setup)

### 1. GitHub Personal Access Token

ל-Worker צריך PAT כדי להפעיל workflows בריפואים שלך.

1. https://github.com/settings/tokens?type=beta → **Generate new token** (Fine-grained)
2. Repository access: **All repositories** (כדי שיעבוד על כל פרויקט עתידי)
3. Permissions: **Actions: Read and write**, **Contents: Read and write**
4. שמור את ה-token — נזדקק לו בשלב 3.

### 2. יצירת KV Namespace

בתוך `worker/`:

```bash
npm install
npx wrangler login
npx wrangler kv namespace create BUGBOT_KV
```

יחזיר `id` — הדבק אותו ב-`worker/wrangler.toml` במקום `REPLACE_WITH_KV_NAMESPACE_ID`.

### 3. הגדרת Secrets ל-Worker

```bash
cd worker
npx wrangler secret put TELEGRAM_BOT_TOKEN        # הטוקן מ-BotFather
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET    # מחרוזת אקראית, תמציא בעצמך (openssl rand -hex 20)
npx wrangler secret put GITHUB_TOKEN               # ה-PAT משלב 1
npx wrangler secret put ALLOWED_CHAT_ID            # ה-Chat ID שלך מ-@userinfobot
npx wrangler secret put BUGBOT_INTERNAL_SECRET     # מחרוזת אקראית נוספת (openssl rand -hex 20)
```

### 4. פריסה

```bash
npx wrangler deploy
```

יחזיר URL כמו `https://claude-bugbot.<your-subdomain>.workers.dev` — שמור אותו.

### 5. רישום ה-Webhook בטלגרם

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://claude-bugbot.<your-subdomain>.workers.dev/telegram-webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

(אותו `TELEGRAM_WEBHOOK_SECRET` שהגדרת בשלב 3.)

### 6. Claude Code OAuth token (חד-פעמי, לא תלוי בפרויקט)

```bash
claude setup-token
```

שומרים את ה-token שמודפס — הוא ישמש בכל הריפואים.

### 7. דחיפת המאגר הזה ל-GitHub

**המאגר הזה חייב להיות ציבורי** (או פרטי + הרשאות מתאימות) כדי ש-`uses:
BenEliyahu/claude-bugbot/.github/workflows/...@main` יעבוד מכל ריפו אחר שלך.

```bash
gh repo create claude-bugbot --public --source=. --remote=origin --push
```

---

## הוספת פרויקט חדש (בכל פעם שיוצרים ריפו חדש)

```bash
cp scripts/.env.bugbot.example scripts/.env.bugbot
# מלא שם: CLAUDE_CODE_OAUTH_TOKEN, TELEGRAM_BOT_TOKEN, BUGBOT_INTERNAL_SECRET, BUGBOT_WORKER_URL

./scripts/setup-new-repo.sh /path/to/new/project
```

הסקריפט מעתיק את קבצי ה-workflow והסקריפטים הנדרשים, ומגדיר את ה-secrets בריפו
החדש דרך `gh secret set`. בסוף — תבדוק את `dev_url`/`dev_command` ב-
`.github/workflows/bugbot.yml` (ברירת המחדל: `npm run dev` על פורט 3000), תוסיף
`playwright` ו-`wait-on` כ-devDependencies, ותדחוף.

## שימוש

בטלגרם, לצ'אט עם הבוט:

```
/fix BenEliyahu/Portfolio: הכפתור "צור קשר" לא מגיב בלחיצה במובייל
```

הבוט יגיב שהוא מתחיל, ותוך כמה דקות ישלח סקרינשוט של האפליקציה עם השינוי +
כפתורי ✅/❌. אישור פותח PR ושולח לינק; דחייה מוחקת את הענף.

## מגבלות ידועות (MVP)

- תומך בפרויקטי Node/Next.js שרצים עם `npm run dev` על פורט קבוע. לפרויקט אחר
  צריך להתאים את `dev_url`/`dev_command`.
- אין ולידציה שה-diff שקלוד עשה בטוח (למשל לא רץ linter/טסטים) — שקול להוסיף
  שלב `npm run lint && npm test` לפני שליחת הסקרינשוט.
- כל ריפו חדש דורש הגדרת 4 secrets בנפרד (אין ל-GitHub personal account
  secrets ברמת ה-org) — `setup-new-repo.sh` עושה את זה בפקודה אחת.
