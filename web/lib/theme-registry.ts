import fs from 'node:fs';
import path from 'node:path';
import { getObject, listCssObjects } from './s3';
import { BUILT_IN_THEMES, type ThemeBase, type ThemeInfo } from './theme';

/**
 * Theme plugin registry — server-only module (filesystem access).
 *
 * Themes are drop-in `.css` files: operators add a file to the theme
 * directory and it shows up in the portal's theme picker — no code changes.
 * See `docs/theming.md` for the authoring guide.
 *
 * Themes load from two operator-controlled sources, in this order:
 *   1. Local directory (`THEME_DIR`, default `<cwd>/themes`) — baked into
 *      the image or volume-mounted.
 *   2. An S3 prefix in the vault bucket (`THEME_VAULT_PREFIX`, opt-in) —
 *      lets a built container self-load themes on start with no rebuild or
 *      mount. Only `.css` keys are read, and no portal write route can ever
 *      create a `.css` key (every write forces `.md`), so this prefix is
 *      not reachable by portal users; it is operator-only at the S3/IAM
 *      level. See the security note in `docs/theming.md`.
 * On an id collision the first source to claim the id wins (disk before S3).
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

/**
 * Parse one theme file and append it to the registry. `filename` is the
 * basename (`forest.css`) used to derive the id; `origin` is a human label
 * for log/CSS comments (the path or `s3:<key>`). Skips (with a warning) a
 * file whose id is empty or already claimed by an earlier source.
 */
function ingestTheme(
  themes: ThemeInfo[],
  cssBlocks: string[],
  filename: string,
  origin: string,
  raw: string,
): void {
  const id = slugify(filename.replace(/\.css$/, ''));
  if (!id) {
    console.warn(`[themes] skipping ${origin}: filename does not yield a usable theme id`);
    return;
  }
  if (themes.some((t) => t.id === id)) {
    console.warn(`[themes] skipping ${origin}: theme id "${id}" is already taken`);
    return;
  }
  const { name, base } = parseHeader(raw);
  themes.push({ id, label: name ?? prettify(id), base: base ?? 'light' });
  // The CSS is inlined into a <style> tag — `</` must never appear
  // unescaped or a crafted file could close the tag and inject markup.
  const body = raw.replace(/<\//g, '<\\/');
  cssBlocks.push(`/* theme plugin: ${origin} */\nhtml[data-theme="${id}"] {\n${body}\n}`);
}

async function loadRegistry(): Promise<ThemeRegistry> {
  const themes: ThemeInfo[] = [...BUILT_IN_THEMES];
  const cssBlocks: string[] = [];

  // Source 1: local theme directory (baked into the image or volume-mounted).
  const dir = process.env.THEME_DIR || path.join(process.cwd(), 'themes');
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.css')).sort();
  } catch {
    // No theme directory — built-ins only. Not an error; the dir is optional.
  }
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf8');
      ingestTheme(themes, cssBlocks, file, file, raw);
    } catch (err) {
      console.warn(`[themes] failed to load ${file}:`, err);
    }
  }

  // Source 2: S3 prefix in the vault bucket (opt-in via THEME_VAULT_PREFIX).
  // `.css` keys only; unreachable by portal write routes (all force `.md`),
  // so it is operator-controlled at the S3 level. See docs/theming.md.
  const vaultPrefix = process.env.THEME_VAULT_PREFIX;
  if (vaultPrefix) {
    try {
      const keys = (await listCssObjects(vaultPrefix)).sort();
      for (const key of keys) {
        try {
          const raw = await getObject(key);
          ingestTheme(themes, cssBlocks, key.split('/').pop() ?? key, `s3:${key}`, raw);
        } catch (err) {
          console.warn(`[themes] failed to load ${key} from vault:`, err);
        }
      }
    } catch (err) {
      console.warn(`[themes] failed to list vault themes under "${vaultPrefix}":`, err);
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

let cached: Promise<ThemeRegistry> | null = null;

export function getThemeRegistry(): Promise<ThemeRegistry> {
  // Dev: re-read every request so theme file edits show up on refresh.
  if (process.env.NODE_ENV === 'development') return loadRegistry();
  cached ??= loadRegistry();
  return cached;
}
