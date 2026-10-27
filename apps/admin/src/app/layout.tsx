import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Daisy admin',
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
