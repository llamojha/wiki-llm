# Theming

Vaultmark's entire UI is driven by CSS custom properties, and the portal
supports **drop-in theme plugins**: a single `.css` file added to a directory
becomes a selectable theme in the top-bar picker. No code changes, no rebuild
(in dev), no fork.

## Quick start

1. Create a file in [`web/themes/`](../web/themes/) — the filename is the
   theme id:

   ```css
   /* web/themes/forest.css
    *
    * @name Forest
    * @base dark
    */

   --accent-h: 152;
   --bg: oklch(17% 0.018 165);
   --panel: oklch(20% 0.02 165);
   ```

2. Restart the server (dev mode picks the file up on the next refresh).
3. The top-bar theme button becomes a picker listing **Light**, **Dark**, and
   **Forest**. The choice is persisted per browser in `localStorage`.

A ready-made example ships at
[`web/themes/forest.css.example`](../web/themes/forest.css.example) — rename
it to `forest.css` to activate it. `.css` files in `web/themes/` are
gitignored: themes are deployment config, not codebase.

## How a theme file works

- The file's contents are wrapped server-side in
  `html[data-theme="<id>"] { … }` and inlined into `<head>`. Write **bare
  variable declarations** at the top level; you can also use [CSS
  nesting](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_nesting) for
  targeted component tweaks (e.g. `& .topbar { … }`).
- `@import` does not work inside the wrapper — themes restyle via variables,
  not external stylesheets.
- Metadata lives in the file's **first comment block**:

  | Tag | Meaning | Default |
  |---|---|---|
  | `@name <label>` | Display name in the picker | Prettified filename (`forest-night` → `Forest Night`) |
  | `@base light\|dark` | Palette that fills in every variable you *don't* set | `light` |

  With `@base dark` the portal also sets `data-base="dark"` on `<html>`, so
  the built-in dark variable block applies underneath your overrides — a dark
  theme can be three lines long.
- Theme ids are filename slugs (lowercase, `a-z0-9-`). `light.css` and
  `dark.css` are skipped — the built-ins are not overridable, by design.
- A malformed file is skipped with a server-log warning; it never breaks the
  portal.

## Variable reference

Defined in [`web/app/globals.css`](../web/app/globals.css) (`:root` = light
values, the `[data-theme="dark"], [data-base="dark"]` block = dark values).

| Variable | Purpose |
|---|---|
| `--accent-h` | Accent hue (oklch). Changing only this re-tints the whole UI. |
| `--accent`, `--accent-soft`, `--accent-fg` | Accent color, translucent accent wash, text on accent. |
| `--bg`, `--bg-1`, `--bg-2`, `--bg-3` | Background scale, page → raised surfaces. |
| `--panel` | Floating panels (menus, modals, chat). |
| `--fg`, `--fg-1`, `--fg-2`, `--fg-3` | Foreground/text scale, strongest → faintest. |
| `--line`, `--line-2` | Hairline borders (default / emphasized). |
| `--hover` | Hover wash for rows and buttons. |
| `--shadow-sm`, `--shadow-md`, `--shadow-lg` | Elevation shadows. |
| `--code-bg`, `--code-border` | Code block surface. |
| `--green`, `--amber`, `--red`, `--blue` | Status colors. |
| `--r-sm`, `--r-md`, `--r-lg`, `--r-xl` | Border radii. |
| `--font-sans`, `--font-serif`, `--font-mono` | Font stacks. |
| `--header-h`, `--sidebar-w`, `--rightbar-w` | Shell dimensions. |

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `THEME_DIR` | `<app cwd>/themes` (= `web/themes/`) | Directory scanned for `*.css` theme plugins. |
| `THEME_VAULT_PREFIX` | — (off) | Optional S3 prefix in the **vault bucket** scanned for `*.css` themes. Lets a built container self-load themes on start — no rebuild, no volume. See [Loading themes from S3](#loading-themes-from-s3). |
| `THEME_DEFAULT` | `dark` | Theme rendered before a visitor has picked one. Any theme id, including a plugin's. |

All three are runtime variables — no rebuild needed. In production the
registry is read once at process start; restart after adding themes. In dev it
re-reads on every request. When the same theme id comes from both the
directory and S3, the directory wins.

## Loading themes from S3

Set `THEME_VAULT_PREFIX` to a key prefix inside the vault bucket
(`VAULT_BUCKET` / `VAULT_PREFIX`) and the container scans it for `*.css` on
start — alongside `THEME_DIR`. This is the zero-mount path for a built
release image: ship the image as-is, drop theme files in S3, restart.

```bash
# operator uploads a theme to the vault bucket (direct S3 — not the portal)
aws s3 cp forest.css s3://$VAULT_BUCKET/$VAULT_PREFIX/_themes/forest.css

docker run -e THEME_VAULT_PREFIX=_themes/ -e THEME_DEFAULT=forest vaultmark
```

The file format, metadata block, and id rules are identical to directory
themes (the id is the object's basename). Themes are read **once** at process
start, so restart the container after changing them.

**Why this is safe even though the bucket is the user's vault:** the loader
reads **only `.css` keys**, and *no portal route can ever write a `.css`
object* — every write path (upload, editor, curate) forces a `.md`
extension, and the content lister (`listObjects`) is `.md`-only. So portal
users cannot plant a theme. The prefix is operator-controlled at the
S3/IAM level — the same trust boundary as a file on disk. Keep it that way:
**do not grant portal users (or any untrusted principal) write access to
this prefix**, and prefer a dedicated prefix (e.g. `_themes/`) over the
document tree.

## Deployment

**Docker** — either bake themes into the image (add `.css` files under
`web/themes/` before `docker build`) or mount them at runtime:

```bash
docker run -v ./my-themes:/app/web/themes:ro -e THEME_DEFAULT=forest vaultmark
```

**Kubernetes** — ship themes in a ConfigMap and mount it:

```yaml
kubectl create configmap vaultmark-themes --from-file=my-themes/
# in the pod spec:
volumeMounts: [{ name: themes, mountPath: /app/web/themes, readOnly: true }]
volumes: [{ name: themes, configMap: { name: vaultmark-themes } }]
```

**ECS** — point `THEME_DIR` at an EFS mount, or bake themes into the image.

## Security note

Theme CSS is inlined into `<head>`, so a theme file is **operator-controlled
code** — the same trust level as the codebase itself. Two sources are
allowed, both operator-controlled: files on the server's disk (`THEME_DIR`)
and `.css` objects under `THEME_VAULT_PREFIX` in the vault bucket. The S3
source is safe because **no portal route can write a `.css` object** (every
write forces `.md`), so portal users cannot plant a theme — but it relies on
that prefix not being writable by untrusted principals at the S3/IAM level.
Theme files are never sourced from user input, and the loader neutralizes
`</` sequences so a file cannot break out of its inline `<style>` tag. Keep
it that way: do not wire `THEME_DIR` or `THEME_VAULT_PREFIX` to anything
users can write to.
