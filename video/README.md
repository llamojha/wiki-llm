# Vaultmark Product Video

Remotion composition for a 60-second Vaultmark product video.

```bash
pnpm --filter @vaultmark/video audio
pnpm --filter @vaultmark/video dev
pnpm --filter @vaultmark/video capture
pnpm --filter @vaultmark/video compositions
pnpm --filter @vaultmark/video still
pnpm --filter @vaultmark/video render
```

Composition:

- `VaultmarkProductVideo`
- 1920x1080
- 30 FPS
- 1800 frames
- generated voiceover and music bed under `video/public/audio/`

## Interactive demo

Open `video/interactive/index.html` in a browser to click through the
captured Vaultmark screens. It uses the latest screenshots under
`video/public/screens/`, so rerun `pnpm --filter @vaultmark/video capture`
after changing the app or vault data.
