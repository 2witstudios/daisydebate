'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../../components/icon/icon';
import { useUiState } from '../../store/store';
import { art } from '../../assets';

function Fact({
  label,
  icon,
  children,
}: {
  readonly label: string;
  readonly icon: IconName;
  readonly children: ReactNode;
}) {
  return (
    <div>
      <dt className="sr-only">{label}</dt>
      <dd className="inline-flex items-center gap-2 text-sm text-ink-muted">
        <Icon name={icon} size={16} />
        {children}
      </dd>
    </div>
  );
}

export function FeaturedTournament() {
  const tournament = useUiState((state) => state.resources.tournament);
  return (
    <section className="relative flex min-h-tournament-min items-stretch overflow-hidden rounded-lg border border-border-strong bg-surface-emerald">
      <div className="relative z-10 flex shrink grow basis-tournament-body flex-col items-start gap-3 p-6 max-narrow:basis-full">
        <header className="flex items-center gap-2 text-gold">
          <Icon name="trophy" size={18} />
          <h2 className="text-md font-heavy text-ink">Featured Tournament</h2>
        </header>
        <p className="mt-1 text-2xl leading-tight font-black tracking-snug text-ink-on-media">
          {tournament.name}
        </p>
        <p className="text-base text-ink-muted">{tournament.tagline}</p>
        <Link
          href="/tournaments"
          className="mt-2 mb-1 inline-flex items-center rounded-sm bg-accent px-6 py-tournament-cta-y text-base font-heavy tracking-slight text-accent-ink no-underline transition duration-140 ease-standard hover:bg-accent-strong active:translate-y-px"
        >
          Register
        </Link>
        <dl className="mt-2 flex flex-col gap-2">
          <Fact label="Dates" icon="calendar">
            {tournament.dates}
          </Fact>
          <Fact label="Prize" icon="trophy">
            {tournament.prizePool}
          </Fact>
          <Fact label="Entry" icon="users">
            {tournament.openToAll ? 'Open to All' : 'Invitational'}
          </Fact>
        </dl>
      </div>
      <div
        className="relative min-w-0 shrink grow basis-tournament-art before:absolute before:inset-0 before:z-1 before:bg-linear-to-r/srgb before:from-surface-emerald before:to-transparent before:to-42% max-narrow:hidden"
        aria-hidden="true"
      >
        <Image
          src={art.earthNight.src}
          alt=""
          fill
          sizes="(max-width: 900px) 100vw, 460px"
          className="object-cover object-tournament-art"
        />
      </div>
    </section>
  );
}
