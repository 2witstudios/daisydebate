import Link from 'next/link';
import { destinationHref } from '../../../features/destinations/destinations';
import { helpTopicHref, helpTopics } from '../../../features/help/topics';

/** The owner's case for Daisy, once published; the card stays hidden until then. */
const caseForDaisyHref: string | null = null;

const points = [
  {
    title: 'Open all the time',
    body: 'No tournament, no travel, no weekend required. Your team can run practice rounds here on any night, in any format.',
  },
  {
    title: 'One ladder to claim',
    body: 'Freestyle is Daisy’s shared standard: one format, one rating, one season ladder. Everyone competes in the same building, so a win here means something.',
  },
  {
    title: 'A home for every league',
    body: 'Leagues can host their own lobby, ladder and tournaments on Daisy, online or in person, with tabulation built in, right where their debaters already are. It is rolling out now in early access.',
  },
] as const;

/** The common questions, each asked and answered once, on Help. */
const questionIds = [
  'ratings',
  'judging',
  'why-freestyle',
  'teams',
  'run-your-league',
  'ranked-recorded',
] as const;

const questions = questionIds.map((id) => {
  const topic = helpTopics.find((entry) => entry.id === id);
  // A renamed Help topic fails here, at module load, never as a link that quietly disappears.
  if (topic === undefined) throw new Error(`Help has no topic ${id}`);
  return [id, topic.question] as const;
});

const button =
  'inline-flex items-center justify-center rounded-round px-6 py-3 text-base font-strong no-underline hover:no-underline';

/** Daisy's vision, for visitors and members alike. */
export function AboutPage({
  caseHref = caseForDaisyHref,
}: {
  readonly caseHref?: string | null;
}) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-10 px-6 pt-5 pb-12 max-narrow:px-4">
      <header className="flex max-w-reading flex-col gap-4">
        <p className="text-xs font-strong tracking-widest text-gold uppercase">
          About Daisy
        </p>
        <h1 className="font-display text-3xl leading-tight font-semibold tracking-tighter text-balance">
          Debate is a sport. It deserves a venue.
        </h1>
        <p className="text-md leading-normal text-ink-muted">
          For most debaters, competing means a few weekends a year, a bus ride
          and a hotel. Daisy is an arena that’s always open: anyone can walk in,
          find an opponent and play, in whatever league or format they debate.
        </p>
      </header>

      <ol className="grid grid-cols-3 gap-8 border-t border-border pt-8 max-compact:grid-cols-1">
        {points.map(({ title, body }, index) => (
          <li key={title} className="flex flex-col gap-2">
            <span
              aria-hidden="true"
              className="font-display text-3xl font-semibold text-ink-faint"
            >
              {String(index + 1).padStart(2, '0')}
            </span>
            <h2 className="font-display text-xl font-semibold">{title}</h2>
            <p className="text-base leading-normal text-ink-muted">{body}</p>
          </li>
        ))}
      </ol>

      <section className="flex flex-col gap-4 rounded-xl bg-surface-stage p-8 text-stage-ink max-narrow:p-5">
        <h2 className="font-display text-2xl font-semibold">
          Seasons worth remembering
        </h2>
        <p className="max-w-reading text-base leading-normal text-stage-ink-muted">
          Every season has a ladder, rivalries and a champion. Ranked rounds can
          be watched live and again afterwards, and records and ballots are
          kept, so your career in debate builds into something you can look back
          on.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href={destinationHref('watch')}
            className={`${button} bg-stage-ink text-surface-stage`}
          >
            Watch a round
          </Link>
          <Link
            href={destinationHref('leaderboard')}
            className={`${button} border border-stage-ink text-stage-ink`}
          >
            See the ladder
          </Link>
        </div>
      </section>

      <div className="grid grid-cols-2 items-start gap-8 max-compact:grid-cols-1">
        <section aria-labelledby="founder-note" className="flex flex-col gap-4">
          <h2 id="founder-note" className="font-display text-2xl font-semibold">
            A note from the founder
          </h2>
          <figure className="m-0 flex flex-col gap-2">
            <blockquote className="m-0 font-display text-xl leading-tight italic">
              “Free speech carries the responsibility to speak truthfully, and
              with that, the right to speak deceitfully.”
            </blockquote>
            <figcaption className="text-sm font-strong text-ink-muted">
              Jono, founder
            </figcaption>
          </figure>
          {caseHref === null ? null : (
            <Link
              href={caseHref}
              className="flex flex-col gap-1 self-start rounded-lg border border-border bg-surface-raised px-5 py-4 no-underline hover:no-underline"
            >
              <span className="text-xs font-strong tracking-widest text-gold uppercase">
                1AC
              </span>
              <span className="font-display text-xl font-semibold text-ink">
                The case for Daisy Debate
              </span>
            </Link>
          )}
        </section>
        <section
          aria-labelledby="common-questions"
          className="flex flex-col gap-3 rounded-xl bg-surface p-6 shadow-1"
        >
          <h2 id="common-questions" className="text-md font-strong">
            Common questions
          </h2>
          <ul className="flex flex-col gap-2 text-base">
            {questions.map(([id, question]) => (
              <li key={id}>
                <Link href={helpTopicHref(id)}>{question}</Link>
              </li>
            ))}
          </ul>
          <Link href="/help" className="text-sm font-strong">
            All questions
          </Link>
        </section>
      </div>
    </div>
  );
}
