import type {
  LiveSection as Read,
  SectionSpeaker,
} from '../../../features/tab/room';
import { cn } from '../../cn';
import { initialsOf } from '../../../lib/initials';
import { ActionButton } from '../action-control/action-control';
import { ListCard, ListHeading } from '../list-card/list-card';

/** What stands at the end of a speaker's line: their time, or where they are. */
export const speakerStatus = (speaker: SectionSpeaker): string | null => {
  switch (speaker.standing.kind) {
    case 'done':
      return speaker.standing.time;
    case 'speaking':
      return 'speaking';
    case 'preparing':
      return 'preparing';
    case 'waiting':
      return null;
  }
};

/**
 * A speech section while its Round is live, as one of its speakers sees it:
 * who has the floor, when the viewer speaks, and the order. It renders
 * outside the product shell, as every live Round does.
 */
export function LiveSection({ section }: { readonly section: Read }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-reading flex-col bg-background">
      <section className="flex flex-col gap-6 bg-surface-stage p-4 text-stage-ink">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-strong">{section.title}</h1>
          <span className="rounded-badge bg-live px-badge-x py-badge-y text-badge font-heavy tracking-wider text-stage-ink uppercase">
            Live
          </span>
        </div>
        <div
          role="img"
          aria-label={`Camera feed of the current speaker, ${section.speaker.name}`}
          className="mx-auto flex size-tab-disc items-center justify-center rounded-full bg-stage-accent font-display text-2xl font-bold text-stage-accent-ink"
        >
          {initialsOf(section.speaker.name).charAt(0)}
        </div>
        <div className="flex items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col">
            <strong className="text-md font-strong">
              {section.speaker.name}
            </strong>
            <span className="text-sm text-stage-ink-muted">
              {section.speaker.position} · &ldquo;{section.speaker.topic}&rdquo;
            </span>
          </div>
          <span className="font-display text-2xl font-bold tabular-nums">
            {section.speaker.clock}
          </span>
        </div>
      </section>
      <div className="flex flex-col gap-4 p-4">
        <section
          aria-label="Your turn"
          className="flex flex-col gap-1 rounded-lg border border-border bg-hue-teal-soft px-4 py-3"
        >
          <p className="text-xs font-heavy tracking-wider text-ink-muted uppercase">
            {section.yourTurn.heading}
          </p>
          <p>{section.yourTurn.detail}</p>
        </section>
        <ListCard>
          <ListHeading>Speaking order</ListHeading>
          <ol>
            {section.order.map((speaker, index) => (
              <li
                key={speaker.name}
                className={cn(
                  'flex items-center gap-4 border-b border-border px-4 py-3 last:border-b-0',
                  speaker.you && 'bg-surface-sunken',
                  (speaker.you || speaker.standing.kind === 'speaking') &&
                    'font-strong',
                )}
              >
                <span className="text-ink-muted tabular-nums">{index + 1}</span>
                <span className="min-w-0 flex-1">
                  {speaker.name}
                  {speaker.school === null ? null : ` · ${speaker.school}`}
                </span>
                <span className="text-sm tabular-nums">
                  {speakerStatus(speaker)}
                </span>
              </li>
            ))}
          </ol>
        </ListCard>
        <p className="text-sm text-ink-muted">{section.note}</p>
        <ActionButton action={section.message} />
      </div>
    </div>
  );
}
