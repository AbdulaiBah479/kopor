import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.kopor.mobile',
  appName: 'Kopor',
  webDir: 'dist',
  android: { allowMixedContent: false },
  server: { androidScheme: 'https' },
  // Screen protection starts off; Kopor switches it on for the PIN screens (and all the time if the owner chose that
  // in Settings), so people can still take screenshots of ordinary screens.
  plugins: { PrivacyScreen: { enable: false } },
};

export default config;
