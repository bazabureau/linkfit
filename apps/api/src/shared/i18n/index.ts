/**
 * Barrel for the server-side i18n module. Callers should import from
 * `../../shared/i18n/index.js` so the entry surface stays narrow as
 * additional template families (digest emails, in-app banners) land
 * in this folder.
 */
export {
  type SupportedLocale,
  DEFAULT_LOCALE,
  normalizeLocale,
  interpolate,
} from "./locale.js";
export {
  type PushTemplateKey,
  renderPushTemplate,
  listPushTemplates,
} from "./push.templates.js";
