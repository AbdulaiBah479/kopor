# Running Kopor after launch

This is the owner's manual for the Kopor service: how it works, what you control, and what to do day to day.

## How Kopor works, in plain words

| Part | What it does | Where it lives | Cost today |
|---|---|---|---|
| **The app** | What shops use. Everything works on the phone, even with no internet | Web address <https://abdulaibah479.github.io/kopor/> (installable), and an Android app built by GitHub | Free |
| **The cloud** | Accounts, sync between phones, staff, backups, invoice links | Supabase project `hpmpbzcloklaeghekjfz` | Free plan |
| **AI and voice** | Speak/type entries, receipt scanning, the advisor | Groq first, Google Gemini as backup, offline answers if both are busy | Free tiers |
| **Payments** | Payment links, USSD codes, payouts, Kopor Pro billing | Monime (each business connects its own account) | ~1.5% per payment, paid by the business |
| **The code** | Every change, tested automatically, then published | GitHub repository `AbdulaiBah479/kopor` | Free |

Shops do not need you to do anything for them to use Kopor: they open the link, try the demo or create their business,
and start recording. Their records stay on their phone unless they create a cloud account.

## Become the admin (once)

1. Open Kopor on your phone → **More → Cloud & account → Create account** with your own phone number.
2. In Supabase → **Edge Functions → Secrets**, add `KOPOR_ADMIN_PHONES` = your number in international form
   without `+` (for example `23276123456`). Several admins: separate with commas.
3. Re-open Kopor → **More**: an **Owner dashboard** row appears, for you only.

The dashboard shows accounts, businesses, weekly activity, Pro subscribers, AI use today, locked accounts,
online payments, and new sign-ups per day. It only ever shows totals, never anyone's records or phone numbers.

## Your routine

**Daily (2 minutes):** look at the Owner dashboard. Answer support messages.

**Weekly (10 minutes):**
- GitHub → **Actions**: every row should be green. **Security** tab: no open alerts.
- GitHub → **Pull requests**: Dependabot proposes updates. If its checks are green, **Merge**. If a check is red,
  leave it and ask your developer.
- Groq and Google AI Studio usage pages: if you are near the free limits, add another free key (see README,
  "AI that never runs out").

**Monthly:** check Supabase → **Usage** against the free plan limits below.

## Common support questions

| Problem | Answer |
|---|---|
| "I forgot my cloud PIN" | **More → Cloud & account → Forgot your PIN?** with the recovery code they saved at sign-up |
| "My account is locked" | It unlocks by itself (15 minutes, longer after more wrong PINs), or immediately with the recovery code |
| "I lost my recovery code too" | In Supabase → Authentication → Users, delete their account. They sign up again and the owner of their business sends a new invite code. Their records are safe on their phone and in the business |
| "My worker cannot join" | The owner opens **Team → the worker → Invite** and sends the code. The worker must sign up with the same phone number the owner entered |
| "The microphone does not work" | Tap the lock next to the web address (or phone Settings → Apps → Kopor → Permissions) and allow the microphone |
| "I changed phones" | Sign in to the cloud account on the new phone, or restore a backup file (Settings → Backup) |

## Changing the app

Every change goes through GitHub: tests run, and if they all pass the website updates by itself within minutes and
every phone picks up the new version the next time Kopor opens. If an update ever causes a problem, open the
commit on GitHub and choose **Revert**: the previous version goes back online the same way.

**Android app:** GitHub → Actions → **Android** → **Run workflow**. The finished APK (for testing) and AAB (for Google
Play) are attached to the run under *Artifacts*. Uploading to Google Play needs a Play Console account ($25 once) and a
signing key; ask your developer the first time.

## Free plan limits, and when to pay

| Service | Free limit (approximate) | Upgrade when |
|---|---|---|
| Supabase | 500 MB database, 50,000 monthly active users, 500,000 server calls a month. Free projects pause after 7 days with no use at all | Before a large launch: **Pro ($25/month)** adds daily backups and removes pausing |
| Groq | Daily request limits per model (Kopor uses three models) | Add more free keys (Gemini, Cerebras, Mistral, OpenRouter) first; paid only at real scale |
| GitHub Pages | ~100 GB of downloads a month | Very large audiences: move hosting to Cloudflare Pages (also free) |
| Domain name | Not needed | Optional: `kopor.sl` or similar for a more professional address (~$10–40/year) |

**Backups:** each shop's records are on their phone, and in the cloud if they have an account. The Supabase free plan
does not keep its own daily backups, so upgrade to Pro once real businesses depend on the cloud.

## If something goes wrong

| What | What users notice | What to do |
|---|---|---|
| AI providers busy or down | Nothing serious: Kopor answers from the records and the offline parser | Nothing; it recovers by itself |
| Supabase down | Records keep working offline; sync waits | Nothing; sync resumes by itself |
| A key leaks (Groq, Gemini, Monime) | Nothing yet | Create a new key, replace it in Supabase secrets, delete the old key |
| A bad update | Something looks or works wrong | Revert the commit on GitHub (see above) |
| Suspicious sign-ins | "Locked accounts" rises on the dashboard | Lockouts already stop PIN guessing; nothing to do unless it stays high for days |

## Where everything is

- App: <https://abdulaibah479.github.io/kopor/>
- Code, updates, security alerts: <https://github.com/AbdulaiBah479/kopor>
- Cloud accounts, data, secrets, logs: <https://supabase.com/dashboard/project/hpmpbzcloklaeghekjfz>
- AI keys: <https://console.groq.com/keys>, <https://aistudio.google.com/apikey>
- Payments: <https://monime.io>
