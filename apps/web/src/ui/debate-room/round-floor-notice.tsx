import { Announcement } from '../components/announcement/announcement';
import { formatCountdown } from '../../lib/clock-display';
import { cn } from '../cn';
import type { RoundSnapshot } from './round';

type Notice = {
  readonly tone: 'point' | 'protected' | 'info';
  readonly title: string;
  readonly body: string;
  /** A count that runs each second; shown, never announced. */
  readonly timer?: string;
};

/** What a point of information means to this seat now, in the room's words (INTX-18). */
const pointNotice = (point: NonNullable<RoundSnapshot['point']>): Notice | null => {
  const { holder, offers, role, window } = point;
  if (holder)
    return {
      tone: 'point',
      title:
        role === 'holder'
          ? 'Your point of information'
          : `${holder.name} has the point of information`,
      body:
        role === 'holder'
          ? 'Your microphone is live. The floor returns to the speaker when the timer runs out.'
          : role === 'speaker'
            ? 'The floor comes back to you when the timer runs out, when they end it, or as soon as you resume.'
            : 'The speech clock keeps running during the point.',
      timer: formatCountdown(holder.remainingMs),
    };
  if (offers.length > 0 && role === 'speaker')
    return {
      tone: 'point',
      title:
        offers.length === 1
          ? `${offers[0]!.name} offers a point of information`
          : `${offers.length} points of information offered`,
      body: 'Accept one or decline. Offers sit down by themselves; your clock keeps running.',
    };
  if (role === 'offering')
    return {
      tone: 'point',
      title: 'Your point of information is offered',
      body: 'The speaker can accept or decline. Otherwise it lapses, and you can offer again.',
      ...(point.ownOfferLapsesInMs === null
        ? {}
        : { timer: formatCountdown(point.ownOfferLapsesInMs) }),
    };
  if (window === 'protected-start' && role !== 'speaker')
    return {
      tone: 'protected',
      title: 'Protected time',
      body: `Points of information open in ${formatCountdown(point.opensInMs)}.`,
    };
  if (window === 'protected-end' && role !== 'speaker')
    return {
      tone: 'protected',
      title: 'Protected time',
      body: 'Points of information are closed for the rest of this speech.',
    };
  return null;
};

/** Prep a side called while this segment runs (INTX-2). */
const prepNotice = (
  called: NonNullable<RoundSnapshot['prepCalled']>,
): Notice => ({
  tone: 'info',
  title: called.own ? 'Your side’s prep is called' : `${called.side} called prep`,
  body: `Prep before ${called.before} starts the moment the ${called.after} ends.`,
});

const tones: Readonly<Record<Notice['tone'], string>> = {
  point: 'bg-butter text-forest',
  protected: 'bg-surface-overlay text-ink',
  info: 'bg-surface-raised text-ink border border-border',
};

/** The floor's points of information and called prep, for this debater. */
export function RoundFloorNotice({
  round,
}: {
  readonly round: Pick<RoundSnapshot, 'point' | 'prepCalled'>;
}) {
  const notices = [
    round.point ? pointNotice(round.point) : null,
    round.prepCalled ? prepNotice(round.prepCalled) : null,
  ].filter((notice) => notice !== null);
  if (notices.length === 0) return null;
  return (
    <div className="flex shrink-0 flex-col gap-2 px-4 pt-3">
      {notices.map((notice) => (
        <div
          key={notice.title}
          data-round-floor-notice={notice.tone}
          className={cn(
            'flex items-center gap-4 rounded-md px-4 py-3',
            tones[notice.tone],
          )}
        >
          <p className="flex min-w-0 flex-1 flex-col gap-0.5">
            <Announcement as="span" kind="progress" className="font-strong">
              {notice.title}
            </Announcement>
            <span className="text-sm">{notice.body}</span>
          </p>
          {notice.timer ? (
            <span
              aria-hidden="true"
              className="text-xl font-strong tabular-nums"
            >
              {notice.timer}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
