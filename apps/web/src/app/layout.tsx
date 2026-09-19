import type { Metadata } from 'next';
import { connection } from 'next/server';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Daisy', template: '%s · Daisy' },
  description: 'Competitive debate, structured like chess.',
};

const navigation = [
  { href: '/play', label: 'Play' },
  { href: '/ranked', label: 'Ranked' },
  { href: '/lobby', label: 'Lobby' },
  { href: '/watch', label: 'Watch' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/tournaments', label: 'Tournaments' },
] as const;

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Nonce CSP (proxy.ts) requires dynamic rendering: statically prerendered
  // pages are generated at build time without the request nonce, which would
  // block every framework script. Every route renders dynamically today.
  await connection();
  return (
    <html lang="en">
      <body>
        <header>
          <nav aria-label="Primary">
            <Link href="/">Daisy</Link>
            <ul>
              {navigation.map((item) => (
                <li key={item.href}>
                  <Link href={item.href}>{item.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        </header>
        <main>{children}</main>
        <footer>
          <Link href="/debates">Debates</Link>
          <Link href="/judge">Judge</Link>
          <Link href="/recordings">Recordings</Link>
          <Link href="/settings">Settings</Link>
        </footer>
      </body>
    </html>
  );
}
