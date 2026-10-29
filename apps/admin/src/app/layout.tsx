import type { ReactNode } from 'react';
import { Fraunces, Instrument_Sans } from 'next/font/google';
import './globals.css';

export const metadata = {
  title: 'Daisy admin',
  robots: { index: false, follow: false },
};

// The same faces as apps/web, self-hosted through next/font: Fraunces for
// headings, Instrument Sans for the console's text.
const sans = Instrument_Sans({
  variable: '--font-face-sans',
  subsets: ['latin'],
  display: 'swap',
});

const display = Fraunces({
  variable: '--font-face-display',
  subsets: ['latin'],
  display: 'swap',
  axes: ['SOFT', 'WONK', 'opsz'],
});

export default function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
