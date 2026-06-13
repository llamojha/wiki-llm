import type { Metadata } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Serif, JetBrains_Mono } from 'next/font/google';
import { themeBootstrapScript } from '@/lib/theme';
import { getThemeRegistry } from '@/lib/theme-registry';
import './globals.css';

const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans-loaded',
  display: 'swap',
});

const serif = IBM_Plex_Serif({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-serif-loaded',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono-loaded',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Vaultmark',
  description: 'S3-backed Markdown knowledge portal for individuals and engineering teams',
  icons: { icon: '/favicon.svg' },
  openGraph: {
    title: 'Vaultmark',
    description: 'S3-backed Markdown knowledge portal for individuals and engineering teams',
    images: [{ url: '/og.svg', width: 1200, height: 630 }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Vaultmark',
    description: 'S3-backed Markdown knowledge portal for individuals and engineering teams',
    images: ['/og.svg'],
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { themes, defaultTheme, css } = await getThemeRegistry();
  return (
    <html
      lang="en"
      data-theme={defaultTheme.id}
      data-base={defaultTheme.base === 'dark' ? 'dark' : undefined}
      className={`${sans.variable} ${serif.variable} ${mono.variable}`}
      // The bootstrap script swaps data-theme/data-base before hydration
      // when the visitor has a stored preference.
      suppressHydrationWarning
    >
      <head>
        {/* Theme plugin CSS comes from operator-controlled files on disk
            (lib/theme-registry.ts), not user content; `</` is neutralized
            before inlining so the block cannot be closed early. */}
        {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript(themes) }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
