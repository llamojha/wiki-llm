import fs from 'node:fs';
import path from 'node:path';
import { BUILT_IN_THEMES, type ThemeBase, type ThemeInfo } from './theme';

/**
 * Theme plugin registry — server-only module (filesystem access).
 *
 * Themes are drop-in `.css` files: operators add a file to the theme
 * directory and it shows up in the portal's theme picker — no code changes.
 * See `docs/theming.md` for the authoring guide.
 *
 *   - Directory: `THEME_DIR` env var, default `<cwd>/themes` (i.e.
 *     `web/themes/` in dev and in the Docker image).
 *   - Theme id: the filename slug (`forest-night.css` → `forest-night`).
 *   - Optional metadata in the file's first comment block:
 *       `@name Forest Night`  — display label (default: prettified slug)
 *       `@base dark`          — inherit unset variables from the built-in
 *                               dark palette (default: light)
 *   - File contents are wrapped in `html[data-theme="<id>"] { … }`, so a
 *     theme is bare CSS declarations (plus optional nested rules) that
 *     override the variables in `app/globals.css`. The `html` prefix gives
 *     plugins higher specificity than the built-in `:root` / `[data-base]`
 *     blocks regardless of stylesheet order.
 *
 * A malformed file is skipped with a warning — a broken theme must never
 * take down the portal. The registry is read once per process in
 * production and on every request in dev (so theme edits hot-reload).
 */

export type ThemeRegistry = {
  /** Built-in themes followed by plugins, in filename order. */
  themes: ThemeInfo[];
  /** Resolved from `THEME_DEFAULT`; falls back to dark. */
  defaultTheme: ThemeInfo;
  /** Concatenated plugin CSS for inlining into <head>. Empty when no plugins. */
  css: string;
};

const FALLBACK_DEFAULT_ID = 'dark';

function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function prettify(slug: string): string {
  return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function parseHeader(css: string): { name?: string; base?: ThemeBase } {
  const comment = css.match(/\/\*([\s\S]*?)\*\//)?.[1] ?? '';
  const name = comment.match(/@name[ \t]+([^\r\n*]+)/)?.[1]?.trim();
  const base = comment.match(/@base[ \t]+(light|dark)/i)?.[1]?.toLowerCase() as
    | ThemeBase
    | undefined;
  return { name, base };
}

function loadRegistry(): ThemeRegistry {
  const themes: ThemeInfo[] = [...BUILT_IN_THEMES];
  const cssBlocks: string[] = [];
  const dir = process.env.THEME_DIR || path.join(process.cwd(), 'themes');

  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.css')).sort();
  } catch {
    // No theme directory — built-ins only. Not an error; the dir is optional.
  }

  for (const file of files) {
    try {
      const id = slugify(file.replace(/\.css$/, ''));
      if (!id) {
        console.warn(`[themes] skipping ${file}: filename does not yield a usable theme id`);
        continue;
      }
      if (themes.some((t) => t.id === id)) {
        console.warn(`[themes] skipping ${file}: theme id "${id}" is already taken`);
        continue;
      }
      const raw = fs.readFileSync(path.join(dir, file), 'utf8');
      const { name, base } = parseHeader(raw);
      themes.push({ id, label: name ?? prettify(id), base: base ?? 'light' });
      // The CSS is inlined into a <style> tag — `</` must never appear
      // unescaped or a crafted file could close the tag and inject markup.
      const body = raw.replace(/<\//g, '<\\/');
      cssBlocks.push(`/* theme plugin: ${file} */\nhtml[data-theme="${id}"] {\n${body}\n}`);
    } catch (err) {
      console.warn(`[themes] failed to load ${file}:`, err);
    }
  }

  const want = slugify(process.env.THEME_DEFAULT ?? '');
  let defaultTheme = want ? themes.find((t) => t.id === want) : undefined;
  if (want && !defaultTheme) {
    console.warn(
      `[themes] THEME_DEFAULT="${process.env.THEME_DEFAULT}" does not match any theme ` +
      `(have: ${themes.map((t) => t.id).join(', ')}); falling back to "${FALLBACK_DEFAULT_ID}"`,
    );
  }
  defaultTheme ??= themes.find((t) => t.id === FALLBACK_DEFAULT_ID)!;

  return { themes, defaultTheme, css: cssBlocks.join('\n\n') };
}

let cached: ThemeRegistry | null = null;

export function getThemeRegistry(): ThemeRegistry {
  // Dev: re-read every request so theme file edits show up on refresh.
  if (process.env.NODE_ENV === 'development') return loadRegistry();
  cached ??= loadRegistry();
  return cached;
}
