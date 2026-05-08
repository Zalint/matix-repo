/**
 * Configuration i18n minimale pour Phase 0.
 * Phase 1 : étendre les locales (wolof, arabe), pluriels, formats date/devise par locale.
 */
export const SUPPORTED_LOCALES = ['fr', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'fr';

export const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'Français',
  en: 'English',
};

export const LOCALE_COOKIE_NAME = 'matix.locale';

export function isLocale(value: string | undefined): value is Locale {
  return value !== undefined && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
