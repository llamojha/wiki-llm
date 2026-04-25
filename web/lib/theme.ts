export type Theme = string;
export type ThemeBase = 'light' | 'dark';

/**
 * A selectable theme. Built-ins are `light` and `dark`; additional themes
 * come from drop-in CSS plugin files loaded by `lib/theme-registry.ts`
 * (server-only). Client components only ever see `ThemeInfo[]` as props.
 */
export type ThemeInfo = {
  /** Slug used as the `data-theme` attribute value and storage key. */
  id: string;
  /** Display name shown in the theme picker. */
  label: string;
  /**
   * Built-in palette the theme inherits unset variables from. `dark` adds
   * `data-base="dark"` to <html> so the dark variable block applies under
   * the plugin's own overrides.
   */
  base: ThemeBase;
};

export const THEME_STORAGE_KEY = 'vaultmark-theme';

export const BUILT_IN_THEMES: ThemeInfo[] = [
  { id: 'light', label: 'Light', base: 'light' },
  { id: 'dark', label: 'Dark', base: 'dark' },
];

/** Apply a theme to <html>. Client-side only. */
export function setDocumentTheme(theme: ThemeInfo): void {
  const el = document.documentElement;
  el.dataset.theme = theme.id;
  if (theme.base === 'dark') el.dataset.base = 'dark';
  else delete el.dataset.base;
}

/**
 * Inline script that runs before React hydrates, eliminating theme flash.
 * Reads localStorage and sets `data-theme` / `data-base` on <html>
 * synchronously. Only theme ids known to the server-rendered registry are
 * honored, so a stale stored id (e.g. a removed plugin) falls back to the
 * SSR default.
 */
export function themeBootstrapScript(themes: ThemeInfo[]): string {
  const baseById: Record<string, ThemeBase> = {};
  for (const t of themes) baseById[t.id] = t.base;
  // <-escape so the JSON can never close the inline <script> tag.
  const json = JSON.stringify(baseById).replace(/</g, '\\u003c');
  return `(function(){try{var m=${json};var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t&&Object.prototype.hasOwnProperty.call(m,t)){var d=document.documentElement;d.dataset.theme=t;if(m[t]==='dark'){d.dataset.base='dark';}else{delete d.dataset.base;}}}catch(e){}})();`;
}
