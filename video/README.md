# Canopy Product Video

Remotion composition for a 60-second Canopy product video.

```bash
pnpm --filter @canopy/video audio
pnpm --filter @canopy/video dev
pnpm --filter @canopy/video capture
pnpm --filter @canopy/video compositions
pnpm --filter @canopy/video still
pnpm --filter @canopy/video render
```

Composition:

- `CanopyProductVideo`
- 1920x1080
- 30 FPS
- 1800 frames
- generated voiceover and music bed under `video/public/audio/`

## Interactive demo

Open `video/interactive/index.html` in a browser to click through the
captured Canopy screens. It uses the latest screenshots under
`video/public/screens/`, so rerun `pnpm --filter @canopy/video capture`
after changing the app or vault data.
