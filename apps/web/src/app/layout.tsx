import Link from 'next/link';
import { AnalyticsClient } from '../ui/analytics/analytics-client';
import { ConsentBanner } from '../ui/analytics/consent-banner';
import { requestAnalytics } from '../lib/request-session';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { connection } from 'next/server';
import { Fraunces, Instrument_Sans } from 'next/font/google';
import { ThemeProvider } from '../ui/theme/theme-provider';
import {
  parseThemePreference,
  THEME_COOKIE,
} from '../ui/theme/theme-preference';
import {
  requestIdentity,
  requestMetadataBase,
  sessionRefreshDueNow,
} from '../lib/request-session';
import { SessionRefresh } from '../ui/auth/session-refresh/session-refresh';
import { RoundNotesPrivacy } from '../ui/debate-room/round-notes-privacy';
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
  return {
    metadataBase: requestMetadataBase(),
    openGraph: { type: 'website', siteName: 'Daisy Debate' },
    twitter: { card: 'summary_large_image' },
    title: { default: 'Daisy Debate', template: '%s · Daisy Debate' },
    description:
      'The arena for competitive debate. Better arguments. A more thoughtful world.',
  };
}

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
  const refreshSession = await sessionRefreshDueNow();
  const analytics = await requestAnalytics();
  const identity = await requestIdentity();
  const notesPrincipal =
    identity.state === 'unavailable'
      ? undefined
      : identity.state === 'anonymous'
        ? null
        : identity.principal.userId;
  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${sans.variable} ${display.variable}`}
    >
      <body>
        <ThemeProvider initialPreference={theme}>
          <RoundNotesPrivacy principalId={notesPrincipal} />
          {children}
          {refreshSession ? <SessionRefresh /> : null}
          {analytics.keyValue ? (
            <>
              <AnalyticsClient {...analytics} />
              <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-reading">
                <ConsentBanner {...analytics} />
              </div>
              <footer className="p-4 text-center text-sm">
                <Link href="/analytics" className="text-ink-muted underline">
                  Analytics preferences
                </Link>
              </footer>
            </>
          ) : null}
        </ThemeProvider>
      </body>
    </html>
  );
}
