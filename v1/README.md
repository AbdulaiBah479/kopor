# Kopor: the business book for every pocket

Kopor ("money" in Krio) is an offline-first web app that replaces the paper notebook for shops, traders,
osusu groups, associations, churches, schools and households.

| Module | What it does |
|---|---|
| **Credit Book** | Who owes you and whom you owe. Due dates, overdue alerts, one-tap WhatsApp/SMS reminders and statements |
| **Cash Book** | Sales and expenses by payment method (Cash, Orange Money, Afrimoney, Bank, Credit), daily profit, best sellers |
| **Stock** | Products, cost and selling price, margin, low-stock alerts. Stock goes down automatically on every sale |
| **Osusu & Groups** | Rotating savings (who collects each round) and dues collection, paid/unpaid ticks, WhatsApp reminders and group updates |
| **Invoices & Receipts** | Professional invoices with a verification code. Share on WhatsApp, print or save as PDF. Unpaid invoices go into the credit book |
| **Health Score & Loan Report** | A 0-100 score (record keeping, profit, credit control, growth) and a printable 90-day report for banks and microfinance lenders |
| **Speak (AI)** | Record by voice or text in English or Krio. Works offline with a built-in parser, and is smarter with a free AI key |

It also has: a PIN lock, backup and restore, light and dark modes, demo data, and installation to the home screen.
It works with no internet connection.

## Run it on your computer

```powershell
cd C:\Users\USER\kopor
powershell -ExecutionPolicy Bypass -File tools\serve.ps1   # no installs needed → http://localhost:5173
# or, with Node.js installed:
npm start
```

**Self-test (no installs needed):** open http://localhost:5173/tests/selftest.html?run in a **private window**.
It clicks through all 33 checks: every screen at phone width, sales and stock, credit, voice, osusu, invoices,
health and PIN lock. It loads demo data, so don't run it in the browser that holds your real records.
With Node.js: `npm install` then `npm test` (uses Playwright with Edge, and saves screenshots in /screenshots).

There is no build step. The app is plain HTML, CSS and JavaScript modules, and none of the app's files depend on npm.

## Put it online for free (needed to use it on phones)

Any of these services gives you a free HTTPS address, which offline mode and installation need:

1. **Netlify Drop**: go to https://app.netlify.com/drop and drag the `kopor` folder onto the page. You get a live link in seconds.
2. **Cloudflare Pages**: run `npx wrangler pages deploy . --project-name kopor`
3. **GitHub Pages**: push the repo, then turn on Settings → Pages.

On an Android phone, open the link in Chrome, then choose menu → **Install app** (or **Add to Home screen**).

**When you change files:** increase `VERSION` in `sw.js` (for example `kopor-v2`) so phones download the new version.

## Free AI setup (optional)

Settings → Smart AI. Get a free key from https://console.groq.com and paste it in.
Any OpenAI-compatible service works if you change the base URL and model:

| Provider | Base URL | Example model |
|---|---|---|
| Groq (default) | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.0-flash` |
| OpenRouter | `https://openrouter.ai/api/v1` | any `:free` model |

Model names change over time. If you get an error, check the provider's model list.
The key is stored only on the phone.

## Code map

```
index.html, sw.js, manifest.webmanifest   app shell, offline cache, install info
css/app.css                              all styles (colors are tokens at the top)
js/db.js                                 IndexedDB wrapper
js/store.js                              data and business rules: balances, sales, stock, osusu rounds, health score
js/ui.js                                 icons, sheets, forms, chart
js/app.js                                router and event wiring
js/views/*.js                            one file per screen
```

## How it makes money

1. **Free core** for everyone. This is the growth engine: every reminder and invoice sent on WhatsApp carries the Kopor name.
2. **Kopor Pro** (around Le 50-100 per month, or a yearly price): cloud backup across several phones, staff accounts, multiple shops, branded invoices, and SMS reminders sent automatically.
3. **Groups and institutions**: schools, associations and churches pay per group for dues tracking and reports.
4. **Lending partnerships** (the biggest revenue): with the user's consent, verified loan-ready reports go to microfinance institutions and banks, which pay per qualified borrower.
5. **Agents**: recruit market "Kopor agents" who sign up shops for a commission.

## Next steps

- Krio interface translation (reviewed by native speakers).
- Cloud sync and multi-device use with Supabase (free tier).
- Orange Money and Afrimoney merchant API integration, for automatic payment matching.
- Automatic SMS reminders through Africa's Talking.
