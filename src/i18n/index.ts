import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en';

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'kri', label: 'Krio' },
  { code: 'fr', label: 'Français' },
] as const;

// Locale used for dates/numbers (Krio uses British English formats).
export const dateLocale = (lang: string) => (lang === 'fr' ? 'fr-FR' : 'en-GB');

i18n.use(initReactI18next).init({
  // Only English (the fallback) is in the first download; Krio and French load when someone picks them (setLanguage).
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React escapes output already
  returnNull: false,
});

/** Switch language, loading Krio or French first if this phone has not used them yet (works offline: they are cached). */
export async function setLanguage(lang: string) {
  if (lang !== 'en' && !i18n.hasResourceBundle(lang, 'translation')) {
    const dict = lang === 'kri' ? (await import('./kri')).default : lang === 'fr' ? (await import('./fr')).default : null;
    if (dict) i18n.addResourceBundle(lang, 'translation', dict, true, true);
  }
  await i18n.changeLanguage(lang);
}

export default i18n;
