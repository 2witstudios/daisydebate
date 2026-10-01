import Link from 'next/link';
import type { SpeechView } from '../../../features/train/live';
import type { LiveLinks, LiveQuery } from '../../../features/train/live-links';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';
import { SpeechClock } from '../speech-clock/speech-clock';

const link = 'no-underline hover:no-underline';

type Props = {
  readonly view: SpeechView;
  readonly links: LiveLinks;
  readonly query: LiveQuery;
};

/** The current speech: its heading, the timer and the turn's controls. */
export function SpeechCard({ view, links, query }: Props) {
  const { turn } = view;
  return (
    <section
      aria-label="Current speech"
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6 shadow-1"
    >
      <div className="flex items-center justify-between gap-2">
        <Badge tone="accent">Practice · Unrated</Badge>
        <span className="text-sm text-ink-muted">{`Turn ${view.number} of ${view.total}`}</span>
      </div>
      <h1 className="font-display text-2xl font-bold text-ink">{turn.name}</h1>
      <p className="text-base text-ink-muted">{view.verb}</p>
      <SpeechClock
        key={turn.seq}
        seconds={turn.lengthSeconds}
        actions={
          <>
            {view.hint !== null ? (
              <Link
                href={links.hint}
                aria-expanded={query.hint}
                className={cn(buttonClass('secondary'), link)}
              >
                {query.hint ? 'Hide hint' : 'Hint'}
              </Link>
            ) : null}
            <Link
              href={links.next.href}
              className={cn(
                buttonClass(view.nextSeq === null ? 'primary' : 'secondary'),
                link,
              )}
            >
              {links.next.label}
            </Link>
            <Link
              href={links.askEnd}
              className={cn(buttonClass('ghost'), link)}
            >
              End debate
            </Link>
          </>
        }
        endHref={
          <Link
            href={links.endNow}
            className={cn(buttonClass('secondary'), link)}
          >
            End debate
          </Link>
        }
      />
    </section>
  );
}
