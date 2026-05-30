import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type { ReactNode } from 'react';

type VideoProps = {
  product: string;
  tagline: string;
};

const colors = {
  ink: '#10141f',
  muted: '#5c667a',
  paper: '#f6f3ec',
  white: '#fffdf8',
  line: '#ded6c7',
  green: '#1f7a5a',
  blue: '#3563d8',
  gold: '#b77a22',
  red: '#b54a43',
  dark: '#18202f',
};

const scenes = [
  { from: 0, duration: 270 },
  { from: 270, duration: 300 },
  { from: 570, duration: 330 },
  { from: 900, duration: 330 },
  { from: 1230, duration: 330 },
  { from: 1560, duration: 300 },
  { from: 1860, duration: 390 },
];

function fade(frame: number, duration: number, overlap = 24) {
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

function pop(frame: number, delay = 0) {
  const { fps } = useVideoConfig();
  return spring({
    frame: frame - delay,
    fps,
    config: { damping: 18, stiffness: 120, mass: 0.8 },
  });
}

function Shell({ children, tone = 'light' }: { children: ReactNode; tone?: 'light' | 'dark' }) {
  return (
    <AbsoluteFill
      style={{
        background: tone === 'dark' ? colors.dark : colors.paper,
        color: tone === 'dark' ? colors.white : colors.ink,
        fontFamily:
          'Inter, IBM Plex Sans, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 44,
          border: `1px solid ${tone === 'dark' ? 'rgba(255,255,255,0.13)' : colors.line}`,
          borderRadius: 28,
          background: tone === 'dark' ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.42)',
        }}
      />
      {children}
    </AbsoluteFill>
  );
}

function Label({ children, color = colors.green }: { children: ReactNode; color?: string }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        width: 'fit-content',
        alignSelf: 'flex-start',
        alignItems: 'center',
        gap: 12,
        padding: '10px 16px',
        borderRadius: 999,
        background: `${color}18`,
        border: `1px solid ${color}40`,
        color,
        fontSize: 22,
        fontWeight: 700,
        letterSpacing: 0,
      }}
    >
      {children}
    </div>
  );
}

function Title({ children, size = 92 }: { children: ReactNode; size?: number }) {
  return (
    <h1
      style={{
        margin: 0,
        fontSize: size,
        lineHeight: 1.02,
        letterSpacing: 0,
        maxWidth: 1280,
        fontWeight: 760,
      }}
    >
      {children}
    </h1>
  );
}

function Body({ children, width = 900 }: { children: ReactNode; width?: number }) {
  return (
    <p
      style={{
        margin: 0,
        maxWidth: width,
        fontSize: 34,
        lineHeight: 1.35,
        color: colors.muted,
      }}
    >
      {children}
    </p>
  );
}

function FileCard({ name, kind, color }: { name: string; kind: string; color: string }) {
  return (
    <div
      style={{
        width: 355,
        padding: 24,
        borderRadius: 16,
        background: colors.white,
        border: `1px solid ${colors.line}`,
        boxShadow: '0 22px 60px rgba(30, 28, 22, 0.09)',
      }}
    >
      <div style={{ color, fontSize: 22, fontWeight: 800, marginBottom: 18 }}>{kind}</div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 25, color: colors.ink }}>{name}</div>
      <div style={{ height: 1, background: colors.line, margin: '22px 0' }} />
      {[0.92, 0.74, 0.82].map((w, i) => (
        <div
          key={i}
          style={{
            width: `${w * 100}%`,
            height: 10,
            borderRadius: 10,
            background: '#e7dfd1',
            marginTop: 11,
          }}
        />
      ))}
    </div>
  );
}

function PortalMock({ frame }: { frame: number }) {
  const cursor = interpolate(frame, [20, 120], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div
      style={{
        width: 1220,
        height: 690,
        borderRadius: 24,
        overflow: 'hidden',
        border: `1px solid ${colors.line}`,
        background: colors.white,
        boxShadow: '0 34px 90px rgba(24, 32, 47, 0.16)',
        display: 'grid',
        gridTemplateColumns: '310px 1fr',
      }}
    >
      <div style={{ background: '#ebe4d8', padding: 28, borderRight: `1px solid ${colors.line}` }}>
        <div style={{ fontSize: 27, fontWeight: 820, marginBottom: 28 }}>Vaultmark</div>
        {['Engineering', 'Runbooks', 'Personal', 'Generated'].map((item, i) => (
          <div
            key={item}
            style={{
              height: 48,
              borderRadius: 10,
              marginBottom: 10,
              padding: '0 14px',
              display: 'flex',
              alignItems: 'center',
              fontSize: 20,
              background: i === Math.round(cursor * 3) ? colors.white : 'transparent',
              color: i === Math.round(cursor * 3) ? colors.ink : colors.muted,
            }}
          >
            {item}
          </div>
        ))}
      </div>
      <div style={{ padding: 44 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 44 }}>
          <Label>Searchable S3 vault</Label>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', color: colors.muted, fontSize: 18 }}>s3://vaultmark/</div>
        </div>
        <h2 style={{ margin: 0, fontSize: 56, letterSpacing: 0 }}>Incident Response Runbook</h2>
        <p style={{ fontSize: 27, lineHeight: 1.45, color: colors.muted, width: 710 }}>
          Render Markdown at request time, keep frontmatter canonical, and navigate by logical spaces.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 40 }}>
          {['S3 source of truth', 'Runtime Markdown', 'Fuse search', 'Deep links'].map((item) => (
            <div
              key={item}
              style={{
                padding: 20,
                borderRadius: 14,
                border: `1px solid ${colors.line}`,
                background: '#faf8f2',
                fontSize: 23,
                fontWeight: 680,
              }}
            >
              {item}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ChatMock({ frame }: { frame: number }) {
  const response = interpolate(frame, [50, 200], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div
      style={{
        width: 640,
        height: 720,
        borderRadius: 24,
        background: colors.white,
        border: `1px solid ${colors.line}`,
        padding: 30,
        boxShadow: '0 30px 80px rgba(16,20,31,0.14)',
      }}
    >
      <div style={{ fontWeight: 820, fontSize: 30, marginBottom: 28 }}>Ask the wiki</div>
      <div style={{ background: '#f0eadf', borderRadius: 18, padding: 22, fontSize: 23, marginBottom: 18 }}>
        How does the indexing flow handle raw S3 documents?
      </div>
      <div style={{ background: colors.dark, color: colors.white, borderRadius: 18, padding: 24, fontSize: 22, lineHeight: 1.35 }}>
        <div style={{ opacity: response }}>
          Raw files are processed into generated Markdown pages, then the catalog is regenerated for search and citations.
          <span style={{ color: '#88d8b0' }}> [1]</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 22, opacity: response }}>
        {['run.ts', 'index.md', 'curate job'].map((cite, i) => (
          <div key={cite} style={{ padding: '10px 13px', borderRadius: 999, background: '#e7f3eb', color: colors.green, fontWeight: 720, fontSize: 18 }}>
            {i + 1}. {cite}
          </div>
        ))}
      </div>
    </div>
  );
}

function Hero({ product, tagline }: VideoProps) {
  const frame = useCurrentFrame();
  const opacity = fade(frame, scenes[0].duration);
  const scale = 0.96 + pop(frame, 10) * 0.04;
  return (
    <Shell>
      <AbsoluteFill style={{ opacity, transform: `scale(${scale})`, justifyContent: 'center', paddingLeft: 150 }}>
        <Label>Markdown knowledge portal</Label>
        <div style={{ height: 34 }} />
        <Title size={112}>{product}</Title>
        <div style={{ height: 28 }} />
        <Body width={980}>{tagline}</Body>
      </AbsoluteFill>
      <div style={{ position: 'absolute', right: 125, bottom: 115, display: 'flex', gap: 22, opacity }}>
        <FileCard name="index.md" kind="catalog" color={colors.green} />
        <FileCard name="runbooks.md" kind="wiki" color={colors.blue} />
      </div>
    </Shell>
  );
}

function Problem() {
  const frame = useCurrentFrame();
  const opacity = fade(frame, scenes[1].duration);
  return (
    <Shell>
      <AbsoluteFill style={{ opacity, padding: 130 }}>
        <Label color={colors.red}>The problem</Label>
        <div style={{ height: 28 }} />
        <Title>Engineering knowledge keeps escaping the system.</Title>
        <div style={{ position: 'absolute', left: 130, bottom: 120, display: 'flex', gap: 24 }}>
          {['Static docs', 'Personal notes', 'Runbooks', 'AI chat output'].map((item, i) => {
            const y = interpolate(frame, [30 + i * 12, 78 + i * 12], [70, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
              easing: Easing.out(Easing.cubic),
            });
            return (
              <div
                key={item}
                style={{
                  transform: `translateY(${y}px)`,
                  width: 380,
                  padding: 34,
                  minHeight: 175,
                  background: colors.white,
                  border: `1px solid ${colors.line}`,
                  borderRadius: 18,
                  boxShadow: '0 20px 60px rgba(16,20,31,0.08)',
                  fontSize: 34,
                  fontWeight: 760,
                }}
              >
                {item}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </Shell>
  );
}

function Vault() {
  const frame = useCurrentFrame();
  const opacity = fade(frame, scenes[2].duration);
  const arrow = interpolate(frame, [70, 180], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <Shell>
      <AbsoluteFill style={{ opacity, padding: 125 }}>
        <Label>Vault architecture</Label>
        <div style={{ height: 26 }} />
        <Title size={78}>S3 is the durable layer. Markdown is the contract.</Title>
        <div style={{ display: 'flex', alignItems: 'center', gap: 42, marginTop: 74 }}>
          <FileCard name="raw/source.md" kind="input" color={colors.gold} />
          <div style={{ width: 240, height: 8, borderRadius: 8, background: colors.line, overflow: 'hidden' }}>
            <div style={{ width: `${arrow * 100}%`, height: '100%', background: colors.green }} />
          </div>
          <FileCard name="generated/wiki.md" kind="output" color={colors.green} />
          <div style={{ width: 240, height: 8, borderRadius: 8, background: colors.line, overflow: 'hidden' }}>
            <div style={{ width: `${arrow * 100}%`, height: '100%', background: colors.blue }} />
          </div>
          <FileCard name="_system/index.md" kind="catalog" color={colors.blue} />
        </div>
      </AbsoluteFill>
    </Shell>
  );
}

function Portal() {
  const frame = useCurrentFrame();
  const opacity = fade(frame, scenes[3].duration);
  return (
    <Shell>
      <AbsoluteFill style={{ opacity, alignItems: 'center', justifyContent: 'center' }}>
        <PortalMock frame={frame} />
        <div style={{ position: 'absolute', left: 130, top: 120 }}>
          <Label>Portal</Label>
          <div style={{ height: 22 }} />
          <Title size={66}>Browse, render, search.</Title>
        </div>
      </AbsoluteFill>
    </Shell>
  );
}

function AskWiki() {
  const frame = useCurrentFrame();
  const opacity = fade(frame, scenes[4].duration);
  return (
    <Shell>
      <AbsoluteFill style={{ opacity, padding: 125, display: 'grid', gridTemplateColumns: '1fr 700px', gap: 70, alignItems: 'center' }}>
        <div>
          <Label color={colors.blue}>Ask-Wiki agent</Label>
          <div style={{ height: 30 }} />
          <Title size={78}>Answers grounded in your vault, not stray context.</Title>
          <div style={{ height: 30 }} />
          <Body>Search, read, cite, refuse when unsupported, and propose pages only with user confirmation.</Body>
        </div>
        <ChatMock frame={frame} />
      </AbsoluteFill>
    </Shell>
  );
}

function PersonalWiki() {
  const frame = useCurrentFrame();
  const opacity = fade(frame, scenes[5].duration);
  return (
    <Shell>
      <AbsoluteFill style={{ opacity, padding: 125 }}>
        <Label>Personal wiki</Label>
        <div style={{ height: 28 }} />
        <Title size={78}>Useful answers become durable Markdown pages.</Title>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 26, marginTop: 72 }}>
          {[
            ['Create', 'Draft new notes in the browser'],
            ['Edit', 'Review before anything is saved'],
            ['Star', 'Keep critical docs one click away'],
          ].map(([title, text], i) => (
            <div
              key={title}
              style={{
                opacity: interpolate(frame, [40 + i * 20, 90 + i * 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
                padding: 40,
                borderRadius: 20,
                background: colors.white,
                border: `1px solid ${colors.line}`,
                minHeight: 250,
              }}
            >
              <div style={{ fontSize: 44, fontWeight: 820, marginBottom: 16 }}>{title}</div>
              <div style={{ fontSize: 28, lineHeight: 1.35, color: colors.muted }}>{text}</div>
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </Shell>
  );
}

function Closing({ product }: { product: string }) {
  const frame = useCurrentFrame();
  const opacity = fade(frame, scenes[6].duration, 34);
  return (
    <Shell tone="dark">
      <AbsoluteFill style={{ opacity, padding: 135 }}>
        <Label color="#88d8b0">Next</Label>
        <div style={{ height: 32 }} />
        <Title size={86}>From Markdown vault to cited wiki, generated docs, and HTML publishing.</Title>
        <div style={{ position: 'absolute', left: 135, bottom: 135 }}>
          <div style={{ fontSize: 58, fontWeight: 820 }}>{product}</div>
          <div style={{ marginTop: 14, color: 'rgba(255,255,255,0.72)', fontSize: 30 }}>
            Knowledge that survives the chat.
          </div>
        </div>
      </AbsoluteFill>
    </Shell>
  );
}

export function VaultmarkProductVideo(props: VideoProps) {
  return (
    <AbsoluteFill>
      <Sequence from={scenes[0].from} durationInFrames={scenes[0].duration}>
        <Hero {...props} />
      </Sequence>
      <Sequence from={scenes[1].from} durationInFrames={scenes[1].duration}>
        <Problem />
      </Sequence>
      <Sequence from={scenes[2].from} durationInFrames={scenes[2].duration}>
        <Vault />
      </Sequence>
      <Sequence from={scenes[3].from} durationInFrames={scenes[3].duration}>
        <Portal />
      </Sequence>
      <Sequence from={scenes[4].from} durationInFrames={scenes[4].duration}>
        <AskWiki />
      </Sequence>
      <Sequence from={scenes[5].from} durationInFrames={scenes[5].duration}>
        <PersonalWiki />
      </Sequence>
      <Sequence from={scenes[6].from} durationInFrames={scenes[6].duration}>
        <Closing product={props.product} />
      </Sequence>
    </AbsoluteFill>
  );
}
