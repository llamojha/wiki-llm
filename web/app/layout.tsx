import type { Metadata } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Serif, JetBrains_Mono } from 'next/font/google';
import { THEME_BOOTSTRAP_SCRIPT } from '@/lib/theme';
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
