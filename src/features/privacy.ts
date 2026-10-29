// Android app: block screenshots and screen recording, and hide Kopor's content in the recent-apps view, while a PIN
// or other private screen is open (or all the time, if the owner switched that on in Settings). Browsers cannot do
// this, so there it does nothing.
import { Capacitor } from '@capacitor/core';

let holds = 0, always = false;
const native = () => Capacitor.isNativePlatform();

async function apply() {
  if (!native()) return;
  const { PrivacyScreen } = await import('@capacitor-community/privacy-screen');
  await (always || holds > 0 ? PrivacyScreen.enable() : PrivacyScreen.disable()).catch(() => {});
}

/** Protect the screen while something private is shown; call the returned function when it is gone. */
export function protectScreen(): () => void {
  holds++; void apply();
  let done = false;
  return () => { if (done) return; done = true; holds = Math.max(0, holds - 1); void apply(); };
}

/** Settings: keep the screen protected all the time. */
export function setAlwaysProtect(on: boolean) { always = on; void apply(); }
