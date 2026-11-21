import Image from 'next/image';
import Link from 'next/link';
import { buttonClass } from '../../components/button/button-class';
import { art } from '../../assets';

const events = [
  {
    title: 'Weekly round robins',
    body: 'A regular event to compete in every week.',
  },
  {
    title: 'Seasonal qualifiers',
    body: 'Qualifying events held each season.',
  },
  {
    title: 'Championships',
    body: 'The events that close out a season.',
  },
] as const;

/**
 * What Daisy plans for tournaments: information only, with nothing to act on.
 * Its tabulation note says whether Daisy Tab's early access is open to the
 * viewer yet.
 */
export function TournamentsInfo({
  tabReleased = false,
}: {
  readonly tabReleased?: boolean;
}) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-5 px-6 pt-5 pb-8 max-narrow:px-4">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold tracking-tighter">
          Tournaments
        </h1>
        <p className="text-base text-ink-muted">
          Here is what we&apos;re planning, from our opening tournament through
          to season championships.
        </p>
        {tabReleased ? (
          <Link
            href="/tournaments/directory"
            className={buttonClass('primary')}
          >
            Browse tournaments
          </Link>
        ) : null}
      </header>
      <section className="relative flex min-h-teaser-min items-stretch overflow-hidden rounded-xl border border-border bg-hue-clay-soft text-ink shadow-1">
        <div className="relative z-1 flex shrink grow basis-teaser-body flex-col justify-center gap-2 p-6 max-narrow:basis-full max-narrow:p-5">
          <h2 className="font-display text-2xl leading-tight font-semibold tracking-tighter text-balance max-narrow:text-xl">
            Public Beta Open
          </h2>
          <p className="text-sm text-ink-muted">
            Our opening tournament. Dates, format and prize pool TBD.
          </p>
        </div>
        <div
          className="relative min-w-0 shrink grow basis-teaser-art before:absolute before:inset-0 before:z-1 before:bg-linear-to-r/srgb before:from-hue-clay-soft before:to-transparent before:to-42% max-narrow:hidden"
          aria-hidden="true"
        >
          <Image
            src={art.laurelArena.src}
            alt=""
            width={art.laurelArena.width}
            height={art.laurelArena.height}
            sizes="(max-width: 900px) 100vw, 460px"
            className="absolute inset-0 size-full object-cover object-teaser-art"
          />
        </div>
      </section>
      <ul className="grid grid-cols-3 gap-4 max-compact:grid-cols-1">
        {events.map(({ title, body }) => (
          <li
            key={title}
            className="flex flex-col gap-1 rounded-xl bg-surface p-6 shadow-1"
          >
            <h2 className="font-display text-xl leading-tile-title font-semibold tracking-tight">
              {title}
            </h2>
            <p className="text-base leading-tile-copy text-ink-muted">{body}</p>
          </li>
        ))}
      </ul>
      <section className="flex flex-col gap-1 rounded-xl bg-surface p-6 shadow-1">
        <h2 className="font-display text-xl leading-tile-title font-semibold tracking-tight">
          Tabulation software
        </h2>
        <p className="text-base leading-tile-copy text-ink-muted">
          {tabReleased
            ? 'Tabulation is open to your account in early access: run your league or tournament on Daisy, online or in person, with pairings, ballots and results in one place.'
            : 'Tabulation is rolling out in early access: running speech and debate tournaments on Daisy, online or in person, with pairings, ballots and results in one place.'}
        </p>
      </section>
    </div>
  );
}
