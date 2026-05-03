export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'vaultmark-theme';
export const DEFAULT_THEME: Theme = 'dark';

// Inline script that runs before React hydrates, eliminating theme flash.
// Reads localStorage and sets `data-theme` on <html> synchronously.
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}})();`;
