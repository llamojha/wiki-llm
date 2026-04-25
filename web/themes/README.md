# Theme plugins

Drop a `.css` file in this directory and it becomes a selectable theme in the
portal's theme picker — no code changes required. The filename is the theme id
(`forest-night.css` → `forest-night`).

```css
/*
 * @name Forest Night     ← display label in the picker (optional)
 * @base dark             ← inherit unset variables from the dark palette (optional)
 */

--accent-h: 150;
--bg: oklch(17% 0.02 160);
```

- Rename [`forest.css.example`](forest.css.example) to `forest.css` to try it.
- Full authoring guide + variable reference: [`docs/theming.md`](../../docs/theming.md).
- `THEME_DIR` env var points the app at a different directory (e.g. a mounted
  volume in Docker/Kubernetes); `THEME_DEFAULT` picks the server-side default.
- `.css` files here are gitignored — your themes are local config, not part of
  the codebase.
