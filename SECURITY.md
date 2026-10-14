# Security policy

Kopor holds business records and connects to mobile money, so security reports are welcome and taken seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting instead:
**Security → Report a vulnerability** on this repository, or go straight to
<https://github.com/AbdulaiBah479/kopor/security/advisories/new>.

Include what you found, how to reproduce it, and what an attacker could do with it. You will get a reply within
7 days, and a fix or a plan within 30 days for confirmed issues. Thank you for helping keep small businesses safe.

## How Kopor protects data

- **On the phone:** records stay in the phone's own storage and work offline. PINs are hashed (PBKDF2) with a lockout
  after repeated wrong tries. Backups can be password-encrypted (AES-GCM).
- **In the cloud (Supabase):** every table uses row-level security, so a user only sees businesses they belong to,
  with role-based permissions (owner, manager, cashier, viewer) checked again on the server. Changes are written to an
  append-only audit log.
- **Payments:** Kopor never holds money. Each business connects its own Monime account (licensed by the Bank of
  Sierra Leone). Monime tokens are encrypted at rest (AES-256-GCM) and only used inside server functions. Webhooks are
  verified with a per-business secret, and every status is re-checked with Monime's API before anything is marked paid.
- **Cloud sign-in:** the password Supabase stores is an HMAC of the PIN with a server-only secret, and direct sign-ups are
  disabled, so every PIN check goes through the `auth-pin` function: 5 wrong PINs lock the account (15 minutes,
  doubling up to 24 hours) and each network has a daily cap. A 6-digit PIN therefore cannot be guessed online.
- **Staff invites:** joining a business needs a one-time code from the owner (hashed, 7-day expiry) AND the invited
  phone number.
- **PIN recovery:** one-time recovery codes are stored only as salted hashes, with a lockout after 5 wrong tries.
- **AI:** server keys never reach the phone; phone numbers are not sent to AI providers.
- **App:** strict Content-Security-Policy, no third-party trackers, crash reports scrubbed of personal data.
- **Repository:** secret scanning with push protection, CodeQL, Gitleaks, OSV-Scanner, OpenSSF Scorecard and Dependabot.
