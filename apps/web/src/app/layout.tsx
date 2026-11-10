import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { connection } from 'next/server';
import { Fraunces, Instrument_Sans } from 'next/font/google';
import { ThemeProvider } from '../ui/theme/theme-provider';
import {
  parseThemePreference,
  THEME_COOKIE,
} from '../features/theme/theme-preference';
import {
  requestBrowserCapture,
  requestMetadataBase,
  requestSearchIndexing,
} from '../lib/request-session';
import { robotsMetadataOf } from '../features/search-indexing/search-indexing';
import './globals.css';

// Self-hosted via next/font: same-origin at runtime, CSP-safe, no dependency.
// Fraunces carries display/editorial voice; Instrument Sans carries UI.
const sans = Instrument_Sans({
  variable: '--font-face-sans',
  subsets: ['latin'],
  display: 'swap',
});

const display = Fraunces({
  variable: '--font-face-display',
  subsets: ['latin'],
  display: 'swap',
  style: ['normal', 'italic'],
  axes: ['SOFT', 'WONK', 'opsz'],
});

export async function generateMetadata(): Promise<Metadata> {
  const robots = robotsMetadataOf(requestSearchIndexing());
  return {
    ...(robots ? { robots } : {}),
    metadataBase: requestMetadataBase(),
    openGraph: { type: 'website', siteName: 'Daisy Debate' },
    twitter: { card: 'summary_large_image' },
    title: { default: 'Daisy Debate', template: '%s · Daisy Debate' },
    description:
      'The arena for competitive debate. Better arguments. A more thoughtful world.',
  };
}

/**
 * The document every page shares: <html>, fonts, theme, metadata and error
 * capture, and nothing a person answers. Visitor features belong to each
 * visitor group's layout (`VisitorFeatures`), never here, so the `(stage)`
 * pages Egress records carry none of them (ADR 0123).
 */
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Nonce CSP (proxy.ts) requires dynamic rendering: statically prerendered
  // pages are generated at build time without the request nonce, which would
  // block every framework script. Every route renders dynamically today.
  await connection();
  // The cookie is read per request (and validated: it is untrusted), so the
  // served <html> already carries the viewer's theme: no inline script, no
  // flash, no hydration mismatch.
  const jar = await cookies();
  const theme = parseThemePreference(jar.get(THEME_COOKIE)?.value);
  return (
    <html
      lang="en"
      data-theme={theme}
      {...requestBrowserCapture()}
      className={`${sans.variable} ${display.variable}`}
    >
      <body>
        <ThemeProvider initialPreference={theme}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
