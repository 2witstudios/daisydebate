import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Fraunces, Instrument_Sans } from 'next/font/google';
import './globals.css';

// Self-hosted via next/font: same-origin at runtime, CSP-safe, no dependency.
// Fraunces carries display/editorial voice; Instrument Sans carries UI.
const sans = Instrument_Sans({
  variable: '--font-sans',
  subsets: ['latin'],
  display: 'swap',
});

const display = Fraunces({
  variable: '--font-display',
  subsets: ['latin'],
  display: 'swap',
  style: ['normal', 'italic'],
  axes: ['SOFT', 'WONK', 'opsz'],
});

export const metadata: Metadata = {
  title: { default: 'Daisy', template: '%s · Daisy' },
  description: 'Competitive debate, structured like chess.',
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Nonce CSP (proxy.ts) requires dynamic rendering: statically prerendered
  // pages are generated at build time without the request nonce, which would
  // block every framework script. Every route renders dynamically today.
  await connection();
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${sans.variable} ${display.variable}`}
    >
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
