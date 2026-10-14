# Kopor 2: business book, payments and AI advisor

[![CI](https://github.com/AbdulaiBah479/kopor/actions/workflows/ci.yml/badge.svg)](https://github.com/AbdulaiBah479/kopor/actions/workflows/ci.yml)
[![Deploy](https://github.com/AbdulaiBah479/kopor/actions/workflows/pages.yml/badge.svg)](https://github.com/AbdulaiBah479/kopor/actions/workflows/pages.yml)
[![CodeQL](https://github.com/AbdulaiBah479/kopor/actions/workflows/codeql.yml/badge.svg)](https://github.com/AbdulaiBah479/kopor/actions/workflows/codeql.yml)

**Try it:** <https://abdulaibah479.github.io/kopor/> (open on a phone and choose "Add to Home screen" to install)

Kopor ("money" in Krio) is an **offline-first** app for shops, market traders, osusu groups, associations, churches,
schools and households. It works without internet on cheap Android phones. When online it syncs to the cloud,
takes mobile money payments, and answers questions about the business in English, Krio or French.

| Area | What it does |
|---|---|
| **Credit Book** | Who owes you and whom you owe; due dates; overdue detection (payments applied to the oldest debt first); WhatsApp/SMS reminders and statements; USSD payment requests |
| **Cash Book** | Sales and expenses by Cash, Orange Money, Afrimoney, QMoney, Bank, Card or Credit; daily profit; best sellers; breakdown by payment method |
| **Stock** | Products, margins, low-stock alerts, a **"runs out in N days" forecast**, restocks that record the expense automatically |
| **Osusu & Groups** | Rotating savings (whose turn it is, payouts) and dues; member reliability score; WhatsApp reminders and group updates; send the pot by mobile money |
| **Invoices & Receipts** | Professional invoices with a verification code; **payment links** and **USSD pay codes** (Monime); a public link for customers; print or PDF |
| **Money: receive & send** | Big **Receive** and **Send** buttons on Home. Works from day one with no partner account: save your Orange Money, Afrimoney and QMoney numbers; send a pay-me message or show a **QR code** that opens a public pay page; Send opens the network's own menu (Orange *144#, Afrimoney *161#) with the number ready, then records the payment as an expense, supplier payment or loan. With Monime: payment links for any amount, USSD pay codes and payouts that confirm themselves and land in the cash book automatically |
| **Payments** | Each business connects its **own** Monime account (licensed by the Bank of Sierra Leone). Kopor never holds funds. Payouts are owner-only |
| **AI** | Speak or type entries ("Aminata tek 2 tin oil 400 on credit"); scan receipts or notebook pages; chat with an advisor about your own numbers. Works offline with rule-based parsing and insights; uses free models (Groq, Gemini, OpenRouter) when online |
| **Staff & branches** | Owner, Manager, Cashier and Viewer roles; multiple branches; staff invited by phone number; switch user on a shared phone; full activity log |
| **Reminders** | A daily queue of overdue debts, payments due soon and unpaid contributions, with "Send next" |
| **Health & loans** | A 0-100 business health score and a printable 90-day **loan-ready report** with a verification code |
| **Security** | PIN lock (PBKDF2, lockout after failed attempts), auto-lock, encrypted backups (AES-256-GCM), Postgres row-level security, server-side secrets, Content-Security-Policy |
| **Languages** | English, Krio and French. Every key is checked by tests. *The Krio and French text should be reviewed by native speakers before launch* |
| **Tax & discounts** | GST/VAT rate, prices with or without tax included, TIN on invoices; discounts on sales and invoices; reports show sales net of tax and the tax collected |
| **Returns & refunds** | Return part of a sale: stock goes back, the customer is refunded (or their debt is reduced for credit sales). Managers only |
| **End-of-day close** | Count the cash drawer; Kopor shows what it should hold, and whether it's over or short |
| **Documents** | Real PDF invoices, receipts and loan reports; Excel export of all records; shared to WhatsApp, Drive or email |
| **Receipt printers** | 58mm and 80mm Bluetooth thermal printers (ESC/POS); classic Bluetooth printers via the free RawBT app |
| **Barcode scanning** | Scan products into a sale or invoice, scan to find stock, scan to set a product code |
| **Kopor Pro** | Free: 1 branch, 3 staff. Pro (paid via Monime): unlimited branches and staff, more AI. Limits are enforced by the server |
| **How it works** | An (i) button on every main screen explains that screen in 4 steps, in all three languages |
| **PIN recovery** | One-time recovery code at sign-up (saved to WhatsApp); reset a forgotten PIN without SMS. Only a salted hash is stored; 5 wrong tries lock it for an hour |
| **Install & share** | Install button (Android/Chrome), offline banner, WhatsApp link preview card, share-the-app message |
| **Help & onboarding** | Guided first-use tour, help and FAQ in 3 languages, privacy policy, terms, account deletion |
| **Reliability** | Crash reporting (Sentry, privacy-scrubbed), friendly error screen, Workbox offline caching (685 KB precached; heavy tools cached on first use) |

### Open-source libraries used

| Need | Library |
|---|---|
| Interface | React, React Router |
| Offline database | Dexie (IndexedDB) |
| Cloud backend | Supabase (Postgres, Auth, Edge Functions) |
| Offline caching | vite-plugin-pwa + Google Workbox |
| Android app | Capacitor (+ Share, Filesystem, Bluetooth LE plugins) |
| Languages | i18next |
| Validation | Zod |
| PDF | jsPDF + jspdf-autotable |
| Excel | SheetJS |
| Barcodes | ZXing (with the browser's built-in BarcodeDetector when available) |
| Receipt printing | @point-of-sale/receipt-printer-encoder (ESC/POS) |
| Guided tour | driver.js |
| Crash reporting | Sentry |
| Payments | Monime API |
| AI | Free-tier chain: Groq (3 models) → Google Gemini → Cerebras → Mistral → GitHub Models → OpenRouter, from [free-llm-api-resources](https://github.com/cheahjs/free-llm-api-resources) |
| QR codes | node-qrcode |
| Security scanning | CodeQL, Gitleaks, OSV-Scanner, OpenSSF Scorecard, Dependabot |
| Linting | ESLint + typescript-eslint, react-hooks, jsx-a11y (accessibility) |
| Testing | Vitest, PGlite (real Postgres in-process), Playwright |

## AI that never runs out

The `ai` Edge Function tries free providers in order and moves on when one is rate-limited, down or has retired a
model ([supabase/functions/_shared/llm.ts](supabase/functions/_shared/llm.ts)). Each Groq model has its own free quota,
so Groq alone gives three. Add more free keys as Supabase secrets to multiply the capacity. Nothing else changes:

| Secret | Free key from |
|---|---|
| `GROQ_API_KEY` (set) | console.groq.com |
| `GEMINI_API_KEY` | aistudio.google.com/apikey |
| `CEREBRAS_API_KEY` | cloud.cerebras.ai |
| `MISTRAL_API_KEY` | console.mistral.ai |
| `GITHUB_MODELS_TOKEN` | github.com/settings/tokens (fine-grained, "Models: read" only) |
| `OPENROUTER_API_KEY` | openrouter.ai/keys |

When no AI is reachable at all (offline, daily limit), the assistant still answers the common questions (who owes me,
what to restock, profit, biggest costs, best sellers) from the records, in English and Krio, and voice entry uses the
offline parser.

## Krio language data

Krio wording and the offline parser's vocabulary were checked against open Krio corpora: every Krio word in the app is
compared with the corpus spelling, and 92 misspellings were corrected (for example *bizines* to **biznɛs**).

- English–Krio sentence pairs (42,349 pairs, derived from OPUS MT560): [michsethowusu/english-krio_sentence-pairs_mt560](https://huggingface.co/datasets/michsethowusu/english-krio_sentence-pairs_mt560), **CC BY 4.0**
- Krio stories with English translations: [Jaward/Krio-Corpus](https://huggingface.co/datasets/Jaward/Krio-Corpus), **Apache 2.0**

Open Krio speech-recognition models exist (e.g. `ghananlpcommunity/w2v-bert-2.0_krio_v3_farmerline`, MIT) and could
power true Krio voice input later; they need a hosted GPU or a 250 MB+ download, so they are not used yet.

## Run it

```powershell
cd C:\Users\USER\kopor
npm install
npm run dev          # http://localhost:5173 (development)
npm run check        # typecheck + unit tests + database security tests + build + browser tests
```

`npm run build` creates `dist/`, a static site you can host anywhere for free.

## Deploy (free)

- **Netlify:** drag the `dist` folder onto https://app.netlify.com/drop
- **Cloudflare Pages:** `npx wrangler pages deploy dist --project-name kopor`
- **GitHub Pages (live now):** every push to `main` is tested and published to <https://abdulaibah479.github.io/kopor/> by the `Deploy web app` workflow

Phones need **HTTPS** for offline mode and installation; all three services provide it.

## Android app (Google Play)

Kopor uses Capacitor. The `Android` GitHub workflow builds the APK and AAB in the cloud, so you don't need
the Android SDK. Run it from GitHub → Actions → Android → *Run workflow*, then download the artifact.
Publishing on Google Play needs a developer account (a one-time $25 fee) and a signing key.

## Cloud setup (Supabase, free tier). Optional: Kopor works fully offline without it

1. Create a project at https://supabase.com.
2. In the **SQL editor**, run `supabase/migrations/0001_schema.sql`, then `0002_security.sql`, then `0003_features.sql`.
3. **Authentication → Providers → Email:** keep it enabled and **turn OFF "Confirm email"**. Kopor accounts use
   phone + 6-digit PIN mapped to an internal address. SMS one-time codes are paid, so you can add them later.
4. **Project Settings → API:** copy the URL and the `anon` key. Either put them in `.env.local`
   (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) before building, or paste them in the app under Settings → Cloud.
   Customer invoice links only work when they're baked into the build.
5. Deploy the Edge Functions (needs the free Supabase CLI):
   ```bash
   supabase functions deploy monime
   supabase functions deploy monime-webhook --no-verify-jwt
   supabase functions deploy ai
   supabase functions deploy billing
   supabase functions deploy delete-account
   supabase secrets set KOPOR_MASTER_KEY="<random 48+ chars>" GROQ_API_KEY="<free key from console.groq.com>" PUBLIC_APP_URL="https://your-site/" APP_ORIGIN="https://your-site"
   # Kopor Pro payments go to YOUR (Kopor's) Monime account:
   supabase secrets set KOPOR_MONIME_SPACE_ID="spc-..." KOPOR_MONIME_TOKEN="..." KOPOR_WEBHOOK_SECRET="<random 32+ chars>" PRO_PRICE_MINOR="7500"
   ```
   In Kopor's own Monime dashboard, add a webhook to `https://<project>.supabase.co/functions/v1/monime-webhook`
   with the header `x-kopor-secret: <KOPOR_WEBHOOK_SECRET>` and the `checkout_session.*` events.

**Optional build settings** (`.env.local`): `VITE_SENTRY_DSN` (free Sentry project, for crash reports),
`VITE_SUPPORT_WHATSAPP` (support number shown in Help), `VITE_SUPPORT_EMAIL` (shown in the privacy policy).

**Google Play listing:** use `https://your-site/#/legal/privacy` as the privacy policy URL. Account deletion is
in Settings → Cloud & account. The privacy policy and terms are templates: have a Sierra Leone lawyer review them.

## Payments (Monime)

Monime is a Sierra Leone payment platform licensed by the Bank of Sierra Leone. It supports Orange Money,
Afrimoney, cards and banks, and charges about 1.5% per transaction.
Each business signs up at https://monime.io, creates an access token, and pastes its **Space ID** and **token** into
Kopor → More → Payments. The token is encrypted with `KOPOR_MASTER_KEY` and is only ever used on the server.
Kopor registers a webhook automatically. The webhook is protected by a per-business secret header, and every status
is **re-checked with Monime's API** before an invoice is marked paid.

> Kopor does **not** hold money or offer wallets, which would need a Bank of Sierra Leone e-money licence
> (National Payment Systems Act 2022). Every payment goes straight into the business's own Monime account.

## Architecture

```
src/
  db/         IndexedDB schema (Dexie), write helpers (ids, timestamps, audit trail), role permissions
  domain/     business logic as pure, tested functions: credit, cash, stock, groups, invoices, health, insights, backup
  cloud/      Supabase client, phone+PIN auth, offline-first sync, payments client
  ai/         offline parser (English/Krio) and AI assistant (any OpenAI-compatible API)
  i18n/       en, kri, fr
  screens/    one file per screen; less-used screens load on demand
  ui/         design system: icons, sheets, toasts, charts, form widgets
supabase/
  migrations/ schema, row-level security, invite claiming, public invoice function
  functions/  monime (payments), monime-webhook, ai (proxy with a daily limit per business)
tests/
  unit/       Vitest: domain logic, crypto, parser, translations
  db/         PGlite: the real migrations, attacked as owner, cashier and stranger
  e2e/        Playwright: the production build driven in Edge or Chrome at phone size
```

**Sync design:** every row carries `updated_at` (client) and `rev` (server sequence). Clients push dirty rows and
pull rows with a higher `rev`. Postgres rejects older updates (last writer wins) and never lets a client change
`org_id`, `created_by`, the owner or the plan. Stock and debts are append-only movements, so phones working
offline at the same time never overwrite each other's sales.

**Money** is stored as integer cents everywhere (client and server), so there are no rounding errors.

## Known limits and next steps

- Phone accounts have no SMS verification yet (no free option exists). Before scaling, turn on Supabase phone OTP
  with Africa's Talking or Twilio, so nobody can register a phone number that isn't theirs.
- Cashiers can re-save rows they created (needed so an interrupted sync can retry). Deletions and other people's
  records are blocked on the server.
- QMoney is recorded as a payment method. Online collection through QMoney depends on Monime adding it.
- Next: native-speaker review of Krio and French, Temne/Mende, barcode scanning, Pro billing.
