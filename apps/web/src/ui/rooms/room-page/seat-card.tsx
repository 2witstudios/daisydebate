import Link from 'next/link';
import type { SeatView } from '../../../features/rooms/view';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';

const occupantText = (seat: SeatView): string => {
  const { occupant } = seat;
  if (occupant.kind === 'person')
    return occupant.you ? 'You' : `@${occupant.handle}`;
  if (occupant.kind === 'ai') return 'Placeholder AI judge';
  if (occupant.kind === 'assigned') return 'Assigned by Daisy at the start';
  return 'Open seat';
};

/** One seat: who holds it, whether they are ready, and what you can do here. */
export function SeatCard({ seat }: { readonly seat: SeatView }) {
  const open = seat.occupant.kind === 'empty';
  return (
    <li
      className={cn(
        'flex flex-col gap-3 rounded-lg border bg-surface p-5 shadow-1',
        open ? 'border-dashed border-border-strong' : 'border-border',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-md font-strong text-ink">{seat.label}</h3>
        {seat.readiness ? (
          <Badge tone={seat.readiness === 'Ready' ? 'accent' : 'neutral'}>
            {seat.readiness}
          </Badge>
        ) : null}
      </div>
      <p
        className={cn(
          'text-base',
          open ? 'text-ink-faint' : 'font-strong text-ink',
        )}
      >
        {occupantText(seat)}
        {seat.occupant.kind === 'ai' ? (
          <span className="ml-2 align-middle">
            <Badge tone="gold">AI</Badge>
          </span>
        ) : null}
      </p>
      {seat.occupant.kind === 'ai' ? (
        <p className="text-sm text-ink-muted">
          Rules at random between the two sides. It does not listen to the
          round, and it never judges ranked debates.
        </p>
      ) : null}
      {seat.action ? (
        <Link
          href={seat.action.href}
          className={cn(
            buttonClass(open ? 'secondary' : 'ghost'),
            'w-fit no-underline hover:no-underline',
          )}
        >
          {seat.action.label}
        </Link>
      ) : null}
    </li>
  );
}
