import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import type { ReactNode } from 'react';

type VideoProps = {
  product: string;
  tagline: string;
};

const colors = {
  ink: '#111827',
  muted: '#667085',
  paper: '#f6f3ec',
  white: '#fffdf8',
  line: '#ded6c7',
  green: '#1f7a5a',
  dark: '#18202f',
};

const scenes = [
  { from: 0, duration: 150 },
  { from: 150, duration: 240 },
  { from: 390, duration: 300 },
  { from: 690, duration: 300 },
  { from: 990, duration: 270 },
  { from: 1260, duration: 300 },
  { from: 1560, duration: 240 },
];

const captions = [
  { from: 0, to: 150, text: 'Your team already writes Markdown.' },
  { from: 150, to: 390, text: 'Vaultmark turns it into a searchable knowledge portal, while docs stay in S3.' },
  { from: 390, to: 690, text: 'Ask-Wiki answers from your vault with scope control and citations.' },
  { from: 690, to: 990, text: 'Upload Markdown, curate raw files, or publish authored pages directly.' },
  { from: 990, to: 1260, text: 'Search across runbooks, specs, generated summaries, and notes.' },
  { from: 1260, to: 1560, text: 'Save durable answers back as reviewed Markdown pages.' },
  { from: 1560, to: 1800, text: 'Vaultmark: portable docs, searchable knowledge, AI-assisted work.' },
];

type ScreenName = 'home' | 'ask-wiki' | 'upload' | 'search' | 'editor';
type ZoomPath = {
  fromScale?: number;
  toScale: number;
  origin: string;
  x?: number;
  y?: number;
};

function fade(frame: number, duration: number, overlap = 28) {
  const enter = interpolate(frame, [0, overlap], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const exit = interpolate(frame, [duration - overlap, duration], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return Math.min(enter, exit);
}

function Shell({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <AbsoluteFill
      style={{
        background: dark ? colors.dark : colors.paper,
        color: dark ? colors.white : colors.ink,
        fontFamily:
          'Inter, IBM Plex Sans, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

function BrowserFrame({
  screen,
  frame,
  lift = 0,
  scaleTo = 1.035,
  zoom,
}: {
  screen: ScreenName;
  frame: number;
  lift?: number;
  scaleTo?: number;
  zoom?: ZoomPath;
}) {
  const shellScale = interpolate(frame, [0, 260], [1, scaleTo], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const y = interpolate(frame, [0, 260], [0, lift], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const imageScale = zoom
    ? interpolate(frame, [20, 220], [zoom.fromScale ?? 1, zoom.toScale], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.out(Easing.cubic),
    })
    : 1;
  const imageX = zoom
    ? interpolate(frame, [20, 220], [0, zoom.x ?? 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.out(Easing.cubic),
    })
    : 0;
  const imageY = zoom
    ? interpolate(frame, [20, 220], [0, zoom.y ?? 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.out(Easing.cubic),
    })
    : 0;

  return (
    <div
      style={{
        width: 1180,
        height: 776,
        borderRadius: 24,
        overflow: 'hidden',
        border: `1px solid ${colors.line}`,
        background: colors.white,
        boxShadow: '0 40px 110px rgba(24, 32, 47, 0.2)',
        transform: `translateY(${y}px) scale(${shellScale})`,
        transformOrigin: 'center center',
        position: 'relative',
      }}
    >
      <div
        style={{
          height: 38,
          borderBottom: `1px solid ${colors.line}`,
          background: '#eee8dc',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 16px',
        }}
      >
        {['#d96a57', '#d6a83f', '#4ca66a'].map((color) => (
          <span key={color} style={{ width: 12, height: 12, borderRadius: 999, background: color }} />
        ))}
        <div
          style={{
            marginLeft: 14,
            height: 20,
            width: 360,
            borderRadius: 999,
            background: 'rgba(255,255,255,0.62)',
            color: colors.muted,
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 14,
          }}
        >
          localhost:3100
        </div>
      </div>
      <Img
        src={staticFile(`screens/${screen}.png`)}
        style={{
          width: '100%',
          height: 'calc(100% - 38px)',
          objectFit: 'contain',
          objectPosition: 'top left',
          display: 'block',
          transform: `translate(${imageX}px, ${imageY}px) scale(${imageScale})`,
          transformOrigin: zoom?.origin ?? 'center center',
        }}
      />
    </div>
  );
}

function Caption({
  eyebrow,
  title,
  body,
  align = 'left',
}: {
  eyebrow: string;
  title: string;
  body: string;
  align?: 'left' | 'right';
}) {
  return (
    <div style={{ width: 560, color: colors.ink, textAlign: align }}>
      <div
        style={{
          display: 'inline-flex',
          width: 'fit-content',
          padding: '9px 14px',
          borderRadius: 999,
          background: `${colors.green}18`,
          border: `1px solid ${colors.green}40`,
          color: colors.green,
          fontSize: 19,
          fontWeight: 760,
          marginBottom: 20,
        }}
      >
        {eyebrow}
      </div>
      <h1 style={{ margin: 0, fontSize: 58, lineHeight: 1.05, letterSpacing: 0, fontWeight: 760 }}>{title}</h1>
      <p style={{ margin: '18px 0 0', color: colors.muted, fontSize: 25, lineHeight: 1.35 }}>{body}</p>
    </div>
  );
}

function ScreenScene({
  screen,
  frame,
  duration,
  eyebrow,
  title,
  body,
  reverse = false,
  zoom,
}: {
  screen: ScreenName;
  frame: number;
  duration: number;
  eyebrow: string;
  title: string;
  body: string;
  reverse?: boolean;
  zoom?: ZoomPath;
}) {
  const opacity = fade(frame, duration);
  const x = interpolate(frame, [0, 42], [reverse ? 40 : -40, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  return (
    <Shell>
      <AbsoluteFill
        style={{
          opacity,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 70,
          gap: 48,
          flexDirection: reverse ? 'row-reverse' : 'row',
        }}
      >
        <div style={{ transform: `translateX(${x}px)` }}>
          <Caption eyebrow={eyebrow} title={title} body={body} align={reverse ? 'right' : 'left'} />
        </div>
        <BrowserFrame screen={screen} frame={frame} lift={reverse ? -12 : 10} zoom={zoom} />
      </AbsoluteFill>
    </Shell>
  );
}

function Hero({ frame, duration, product, tagline }: { frame: number; duration: number; product: string; tagline: string }) {
  const opacity = fade(frame, duration);
  const screenOpacity = interpolate(frame, [32, 82], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <Shell>
      <AbsoluteFill style={{ opacity, padding: 70 }}>
        <div style={{ position: 'absolute', left: 98, top: 132, width: 650, zIndex: 2 }}>
          <div
            style={{
              width: 'fit-content',
              padding: '10px 16px',
              borderRadius: 999,
              background: `${colors.green}18`,
              border: `1px solid ${colors.green}40`,
              color: colors.green,
              fontSize: 22,
              fontWeight: 760,
              marginBottom: 34,
            }}
          >
            Real Vaultmark UI
          </div>
          <h1 style={{ margin: 0, fontSize: 102, lineHeight: 0.98, letterSpacing: 0, fontWeight: 780 }}>{product}</h1>
          <p style={{ margin: '28px 0 0', color: colors.muted, fontSize: 35, lineHeight: 1.32 }}>{tagline}</p>
        </div>
        <div style={{ position: 'absolute', right: -210, bottom: -118, opacity: screenOpacity }}>
          <BrowserFrame screen="home" frame={frame} lift={-18} scaleTo={1.02} zoom={{ toScale: 1.12, origin: '58% 45%', x: -34, y: -18 }} />
        </div>
      </AbsoluteFill>
    </Shell>
  );
}

function Closing({ frame, duration }: { frame: number; duration: number }) {
  const opacity = fade(frame, duration);
  const y = interpolate(frame, [0, 70], [34, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  return (
    <Shell dark>
      <AbsoluteFill style={{ opacity, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 90 }}>
        <div style={{ transform: `translateY(${y}px)`, textAlign: 'center', maxWidth: 1180 }}>
          <div style={{ color: '#93e0bb', fontSize: 24, fontWeight: 760, marginBottom: 24 }}>Vaultmark</div>
          <h1 style={{ margin: 0, fontSize: 82, lineHeight: 1.04, letterSpacing: 0 }}>
            Portable docs. Searchable knowledge. AI-assisted work.
          </h1>
          <p style={{ margin: '28px auto 0', color: 'rgba(255,255,255,0.72)', fontSize: 30, lineHeight: 1.38, maxWidth: 920 }}>
            Vaultmark keeps Markdown in S3 and turns it into a cited, usable knowledge portal.
          </p>
        </div>
      </AbsoluteFill>
    </Shell>
  );
}

function NarrationCaption({ frame }: { frame: number }) {
  const caption = captions.find((c) => frame >= c.from && frame < c.to);
  if (!caption) return null;
  const localFrame = frame - caption.from;
  const opacity = interpolate(localFrame, [0, 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 42,
        transform: 'translateX(-50%)',
        maxWidth: 1160,
        padding: '15px 22px',
        borderRadius: 14,
        background: 'rgba(13, 18, 28, 0.86)',
        border: '1px solid rgba(255, 255, 255, 0.14)',
        color: '#fffdf8',
        fontSize: 26,
        lineHeight: 1.24,
        textAlign: 'center',
        boxShadow: '0 18px 55px rgba(0,0,0,0.22)',
        opacity,
      }}
    >
      {caption.text}
    </div>
  );
}

export function WebsiteProductVideo({ product, tagline }: VideoProps) {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill>
      <Audio src={staticFile('audio/music-bed.wav')} volume={0.18} />
      <Audio src={staticFile('audio/voiceover.wav')} volume={1} />
      <Sequence from={scenes[0].from} durationInFrames={scenes[0].duration}>
        <Hero frame={frame - scenes[0].from} duration={scenes[0].duration} product={product} tagline={tagline} />
      </Sequence>
      <Sequence from={scenes[1].from} durationInFrames={scenes[1].duration}>
        <ScreenScene
          screen="home"
          frame={frame - scenes[1].from}
          duration={scenes[1].duration}
          eyebrow="Real workspace"
          title="Your Markdown vault becomes a portal."
          body="Vaultmark opens with real S3 content: spaces, counts, recent docs, and a path into AI-assisted knowledge work."
          zoom={{ toScale: 1.18, origin: '46% 68%', x: -28, y: -42 }}
        />
      </Sequence>
      <Sequence from={scenes[2].from} durationInFrames={scenes[2].duration}>
        <ScreenScene
          reverse
          screen="ask-wiki"
          frame={frame - scenes[2].from}
          duration={scenes[2].duration}
          eyebrow="Ask-Wiki"
          title="Ask questions grounded in your docs."
          body="Scope the assistant to shared, personal, or both libraries, then turn useful answers into reviewed pages."
          zoom={{ toScale: 1.24, origin: '82% 48%', x: -72, y: -8 }}
        />
      </Sequence>
      <Sequence from={scenes[3].from} durationInFrames={scenes[3].duration}>
        <ScreenScene
          screen="upload"
          frame={frame - scenes[3].from}
          duration={scenes[3].duration}
          eyebrow="Markdown ingest"
          title="Upload, curate, and publish Markdown."
          body="Raw files can flow through AI curation, while authored pages land directly in the vault."
          zoom={{ toScale: 1.24, origin: '50% 52%', x: -18, y: -26 }}
        />
      </Sequence>
      <Sequence from={scenes[4].from} durationInFrames={scenes[4].duration}>
        <ScreenScene
          reverse
          screen="search"
          frame={frame - scenes[4].from}
          duration={scenes[4].duration}
          eyebrow="Search"
          title="Find anything without moving content."
          body="Runbooks, specs, generated summaries, and decisions stay in Markdown while search makes them instantly reachable."
          zoom={{ toScale: 1.2, origin: '50% 28%', x: -8, y: -18 }}
        />
      </Sequence>
      <Sequence from={scenes[5].from} durationInFrames={scenes[5].duration}>
        <ScreenScene
          screen="editor"
          frame={frame - scenes[5].from}
          duration={scenes[5].duration}
          eyebrow="Personal wiki"
          title="Save durable knowledge back to Markdown."
          body="The editor keeps source and preview side by side, so every AI-assisted write remains reviewed by the user."
          zoom={{ toScale: 1.18, origin: '64% 30%', x: -26, y: -18 }}
        />
      </Sequence>
      <Sequence from={scenes[6].from} durationInFrames={scenes[6].duration}>
        <Closing frame={frame - scenes[6].from} duration={scenes[6].duration} />
      </Sequence>
      <NarrationCaption frame={frame} />
    </AbsoluteFill>
  );
}
