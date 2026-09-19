import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

const areas = [
  {
    href: '/play',
    title: 'Play',
    description: 'Start or join a debate in the format of your choice.',
  },
  {
    href: '/ranked',
    title: 'Ranked',
    description: 'Rated competitive debates with seasonal ladders.',
  },
  {
    href: '/lobby',
    title: 'Lobby',
    description: 'Open tables, matchmaking queues, and challenges.',
  },
  {
    href: '/watch',
    title: 'Watch',
    description: 'Follow live debates as a spectator.',
  },
  {
    href: '/leaderboard',
    title: 'Leaderboard',
    description: 'Ratings and rankings across formats.',
  },
  {
    href: '/tournaments',
    title: 'Tournaments',
    description: 'Organized bracket and round-robin events.',
  },
] as const;

export default function HomePage() {
  return (
    <section>
      <h1>Daisy</h1>
      <p>
        Competitive debate with the structure of online chess: ratings,
        matchmaking, judges, tournaments, and recordings.
      </p>
      <p>
        This deployment is the production foundation. Product areas are routing
        shells while the engine, protocol, and infrastructure prove out.
      </p>
      <ul>
        {areas.map((area) => (
          <li key={area.href}>
            <Link href={area.href}>{area.title}</Link>: {area.description}
          </li>
        ))}
      </ul>
    </section>
  );
}
