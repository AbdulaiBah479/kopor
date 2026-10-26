// Privacy policy and terms of use. Reachable without signing in (#/legal/privacy, #/legal/terms) so the
// URL can be given to Google Play. TEMPLATE: have a Sierra Leone lawyer review before launch.
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { COPYRIGHT, Copyright, OWNER } from '@/ui/Copyright';

const EMAIL = import.meta.env.VITE_SUPPORT_EMAIL as string | undefined;
const WHATSAPP = import.meta.env.VITE_SUPPORT_WHATSAPP as string | undefined;
const CONTACT = [EMAIL && `email ${EMAIL}`, WHATSAPP && `WhatsApp +${WHATSAPP.replace(/^\+/, '')}`].filter(Boolean).join(' or ')
  || 'the support contact shown on Kopor’s app store page';
const UPDATED = '14 October 2026';

const PRIVACY: [string, string[]][] = [
  ['Who we are', ['Kopor is a business record-keeping app. This policy explains what information Kopor handles and your choices.']],
  ['Information you enter', [
    'Business details, customers and suppliers (names, phone numbers), sales, expenses, stock, invoices, savings-group records and staff names.',
    'By default this information is stored only on your phone. It is sent to our cloud servers (Supabase) only if you create a Kopor account to back up, sync or add staff.',
  ]],
  ['How we use information', [
    'To provide the app: keep your records, sync your devices, send reminders you choose to send, and create invoices and reports.',
    'We do not sell your information and do not use it for advertising.',
  ]],
  ['AI features', [
    'If you use voice entry, receipt scanning or the AI advisor, the voice recording, text or photo and a short summary of your business figures are sent to an AI provider (Groq or Google) to produce the answer. Phone numbers are not included in the summary. Kopor does not keep voice recordings after they are written down.',
    'To share the free AI allowance fairly, people without an account are counted per network address. The address is scrambled (hashed) and never stored in a readable form, and the count is deleted after a few days.',
    'Do not use AI features if you do not agree. Everything else in Kopor works without them.',
  ]],
  ['Staff location', [
    'Tapping in can check how far the phone is from the shop; only that distance is saved with the tap-in, not the place.',
    'If the business owner switches on live location, a staff member’s position is shared with the owner and managers only after that person agrees on their own phone, only while they are tapped in, and it stops when they tap out. The Android app shows a notification the whole time. Each person can stop sharing at any time. Positions are deleted after 30 days.',
  ]],
  ['Payments', ['Mobile money and card payments are processed by Monime, a payment provider licensed by the Bank of Sierra Leone, under its own privacy policy. Kopor stores only the payment status and reference, never card numbers or mobile money PINs.']],
  ['Crash reports', ['If enabled, anonymous error reports (no names, phone numbers or business records) are sent to Sentry so we can fix problems.']],
  ['Security', ['Records on your phone can be protected with a PIN. Backups can be encrypted with a password. Cloud accounts are locked for a while after repeated wrong PINs, and PINs are never stored in a readable form. Staff join a business only with a one-time invite code from the owner. Cloud data is protected with access rules so that only members of a business can see it, and payment keys are encrypted on the server. To run the service, help you when you ask and stop fraud, Kopor’s support team can see account and business summaries (names, phone numbers, staff, totals and recent activity) and can suspend an account that is used for fraud. Every time they open a business is written down.']],
  ['Keeping and deleting data', [
    'You can delete a business from your phone at any time in Settings. If you have an account, Settings → Delete my account removes you from all businesses, closes businesses where you are the only owner, and deletes your login.',
    'Your customers can ask you to correct or delete their details; you can do this in the Credit Book.',
  ]],
  ['Children', ['Kopor is intended for people aged 18 or older running a business, group or household.']],
  ['Contact', [`Questions or requests: ${CONTACT}.`]],
];

const TERMS: [string, string[]][] = [
  ['Using Kopor', ['By using Kopor you agree to these terms. Kopor is provided to help you keep business records; you are responsible for the accuracy of what you enter.']],
  ['Not financial or tax advice', ['Reports, health scores, tax calculations and AI suggestions are tools to help you. They are not professional financial, legal or tax advice. Check important decisions and tax filings with a qualified adviser and the National Revenue Authority.']],
  ['Payments and money', ['Kopor does not hold, transfer or store money. Payments are made through your own Monime account and are subject to Monime’s terms and fees. Kopor Pro subscriptions are paid in advance and renew only when you pay again.']],
  ['Ownership of Kopor', [
    `Kopor (the app, website, source code, designs, screens, text and translations), the name “Kopor” and the Kopor logo belong to ${OWNER} and are protected by copyright and trademark law, including the Copyright Act 2011 of Sierra Leone. ${COPYRIGHT}`,
    'You may use the official Kopor app for your business under these terms. You may not copy, change, resell, rebrand or publish Kopor or its code, take it apart to make a similar product, or use the Kopor name or logo for anything else, without written permission.',
  ]],
  ['Your data', ['You own the records you enter. You give Kopor permission to store and process them only to provide the service. Keep backups; we are not responsible for data lost on a phone that is lost, damaged or reset without a backup.']],
  ['Acceptable use', ['Do not use Kopor for fraud, money laundering, harassment of customers, or anything illegal in Sierra Leone or where you live. Reminders must be polite and lawful.']],
  ['Availability', ['We work to keep Kopor available but the service is provided “as is”. Offline features keep working without internet; cloud features may sometimes be unavailable.']],
  ['Liability', ['To the extent allowed by law, Kopor is not liable for indirect losses or for losses caused by incorrect records, third-party services (Monime, mobile networks, AI providers) or events outside our control.']],
  ['Changes', ['We may update these terms. Continuing to use Kopor after an update means you accept the new terms.']],
  ['Contact', [`${CONTACT}.`]],
];

export function Legal() {
  const { doc } = useParams();
  const { t } = useTranslation();
  const privacy = doc !== 'terms';
  const sections = privacy ? PRIVACY : TERMS;
  return (
    <main className="shell" style={{ paddingBottom: 24 }}>
      <div className="content" style={{ paddingTop: 20 }}>
        <Link to="/" className="small">← Kopor</Link>
        <h1 style={{ fontSize: 24 }}>{privacy ? t('legal.privacy') : t('legal.terms')}</h1>
        <div className="small muted">Last updated: {UPDATED}</div>
        {sections.map(([h, ps]) => (
          <section key={h} className="card flat">
            <h2>{h}</h2>
            {ps.map((p, i) => <p key={i} className="small" style={{ margin: '6px 0' }}>{p}</p>)}
          </section>
        ))}
        <Copyright />
      </div>
    </main>
  );
}
