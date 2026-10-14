import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en';
import kri from './kri';
import fr from './fr';

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'kri', label: 'Krio' },
  { code: 'fr', label: 'Français' },
] as const;
export type Lang = (typeof LANGUAGES)[number]['code'];

// Locale used for dates/numbers (Krio uses British English formats).
export const dateLocale = (lang: string) => (lang === 'fr' ? 'fr-FR' : 'en-GB');

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, kri: { translation: kri }, fr: { translation: fr } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React escapes output already
  returnNull: false,
});

export default i18n;
