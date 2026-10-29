# Google Play: everything to paste

Ready-made text and answers for the Play Console (play.google.com/console), in the order Google asks for them.
Check each answer is still true before you submit; Google can remove an app whose answers are wrong.

## 1. App details

- **App name** (max 30): `Kopor: Business Book & MoMo`
- **Short description** (max 80): `Sales, credit, stock, staff and mobile money for your shop. Works offline.`
- **Category**: Business. **Tags**: Business, Finance, Productivity.
- **Contact email**: babdulai225.2@gmail.com. **Phone**: +232 72 082 348.
- **Privacy policy URL**: `https://abdulaibah479.github.io/kopor/#/legal/privacy`

**Full description** (max 4000):

> Kopor is the free business book for shops and small businesses in Sierra Leone. Know your real profit, get paid
> what you are owed, and stop losses, from your phone, even without internet. In English, Krio and French.
>
> RECORD EVERYTHING IN SECONDS
> • Sales, expenses and stock, by tapping, scanning a barcode, photographing a receipt, or just speaking
>   (English or Krio).
> • Credit book: who owes you, how much and since when, with polite WhatsApp and text reminders.
> • Suppliers: what you owe and when to pay.
> • Invoices, quotations, receipts and a price list with a QR code for customers.
>
> KNOW YOUR MONEY
> • Today's profit on the first screen; "Money now" shows cash in the drawer, mobile money, debts and stock.
> • Close the day: count the cash and check mobile money against your own phone.
> • Weekly report, profit and loss, GST report, and a Credit Passport for lenders.
>
> STOP THEFT AND SCAMS
> • Fraud watch spots cash shortages, deleted sales, cheap selling, fake mobile money messages, back-dated
>   records and more, and alerts you at once.
> • Staff tap in and out; optional live location during working hours (each person agrees first).
> • Big refunds and old deletions need the owner's approval. PIN lock, tamper-proof history, encrypted backups.
>
> FOR THE WHOLE TEAM
> • Owners, managers, cashiers and viewers each see only what they should.
> • Several branches, several phones, all in sync.
> • Osusu, savings and loan groups with member links.
>
> Works offline. Free to use; Kopor Pro adds more branches, staff and AI help.

## 2. Graphics

- **App icon** 512 × 512: `public/icons/icon-512.png`.
- **Feature graphic** 1024 × 500: ask me to make one.
- **Phone screenshots** (2 to 8): the files in `screenshots/` made by the automatic test (Home, credit, closing,
  Fraud watch, staff, picture mode). Use the newest ones from the CI run's "screenshots" download.

## 3. App content (Policy → App content)

| Question | Answer |
|---|---|
| Ads | No ads. |
| App access | Some features need a sign-in: give the reviewer a test account (phone + PIN) and say "Open demo business" also works without one. |
| Target audience | 18 and over. Not designed for children. |
| News app | No. |
| Government app | No. |
| Financial features | Yes: "Money transfer and wire services" is **no**; choose **Other: business record keeping; payments are processed by Monime, a licensed payment provider in Sierra Leone**. Upload the Monime partnership letter when you have it. |
| Health | No. |

## 4. Data safety (the form Google shows on the store page)

**Does the app collect or share user data?** Yes (when a business turns on the cloud).
**Is all data encrypted in transit?** Yes (HTTPS only).
**Can users ask for their data to be deleted?** Yes: Settings → Delete my account, or by WhatsApp/email.

| Data type | Collected | Shared | Why | Optional? |
|---|---|---|---|---|
| Name, phone number | Yes | No | Account, staff list | Required for cloud accounts |
| Financial info (sales, purchases, debts) | Yes | No | App functionality | Required for cloud backup/sync |
| Precise location | Yes | No | Staff tap-in check and live location during working hours | Optional (owner switches it on; each person agrees) |
| Photos | Yes (receipts, when the user chooses) | Shared with AI service to read them, then not kept | App functionality | Optional |
| Audio | Yes (voice entry, when the user taps the microphone) | Shared with speech service to transcribe, then not kept | App functionality | Optional |
| Crash logs, diagnostics | Yes | No | Fix bugs (Sentry; no names or records) | Required |
| Device IDs | Yes (a random id per phone for the phones list) | No | Security (sign out a lost phone) | Required for cloud accounts |

"Shared" means sent to another company for their own use: Kopor's AI and speech providers only process the
photo/recording to answer, so Google's own definition counts this as "processed", not "shared". Read Google's
help text next to each question and keep the answers consistent with the privacy policy in the app.

## 5. Permissions Google asks you to explain

**Location in the background (FOREGROUND_SERVICE_LOCATION)**. Google needs a written reason and a short video
(30 seconds, phone screen recording):

> Kopor is a business record app for shops. When the business owner turns on "Live location during working
> hours", each staff member must agree on their own phone. Then, only while they are at work (tapped in, or within
> the business hours the owner set), their position is shared with the owner and managers so they can see staff
> are at the shop and catch fake attendance. A notification shows the whole time sharing is on; it stops at tap-out
> or closing time, and each person can stop it at any time. Positions are deleted after 30 days.

Video to record: Staff & attendance → owner switches on live location → staff phone shows "Share your location
while you work?" → I agree → the notification appears → owner sees the dot on the map → staff taps out → the
notification goes away.

**Camera**: scanning barcodes and photographing receipts. **Microphone**: voice entry. **Notifications**:
reminders and fraud alerts. **Bluetooth**: printing receipts on a Bluetooth printer.

## 6. Release

1. Testing → **Internal testing** first (up to 100 testers by email), then **Closed testing**: Google's rule for new personal
   developer accounts (check it is still the same in the Console) is a closed test with **at least 12 testers for
   14 days** before going public. Your shop testers can be those testers.
2. Upload the signed release bundle (`.aab`) from the Android build (ask me to set up the release signing key
   first: it is a one-time step and the key must be kept safe for ever).
3. Production → countries: Sierra Leone (and any others) → submit for review (usually a few days).
