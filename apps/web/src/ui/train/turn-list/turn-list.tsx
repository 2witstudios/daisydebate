import type { TurnRow } from '../../../features/train/live';
import { Icon } from '../../components/icon/icon';
import { cn } from '../../cn';
import { TrainCard } from '../card/train-card';

const markClass = (state: TurnRow['state']) =>
  cn(
    'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-round text-xs font-bold',
    state === 'done' && 'bg-accent-soft text-accent',
    state === 'current' && 'bg-accent text-accent-ink',
    state === 'failed' && 'bg-live-soft text-live',
    state === 'todo' && 'border border-border text-transparent',
  );

const stateWords: Readonly<Record<TurnRow['state'], string>> = {
  done: 'done',
  current: 'now',
  failed: 'opponent unavailable',
  todo: 'to come',
};

export type TurnListProps = {
  readonly rows: readonly TurnRow[];
  readonly note?: string;
  readonly footer?: { readonly label: string; readonly value: string };
};

/** The debate's turns, in order, with where it stands. */
export function TurnList({ rows, note, footer }: TurnListProps) {
  return (
    <TrainCard title="Turns" sample>
      {note ? <p className="text-sm text-ink-muted">{note}</p> : null}
      <ol className="flex flex-col gap-1">
        {rows.map((row) => (
          <li
            key={row.seq}
            className={cn(
              'flex items-center gap-3 rounded-md p-2',
              row.state === 'current' && 'bg-accent-soft',
            )}
          >
            <span className={markClass(row.state)} aria-hidden="true">
              {row.state === 'done' ? <Icon name="check" size={14} /> : null}
              {row.state === 'failed' ? '!' : null}
              {row.state === 'current' ? '•' : null}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span
                className={cn(
                  'text-base',
                  row.state === 'todo' ? 'text-ink-muted' : 'text-ink',
                  row.state === 'current' && 'font-strong',
                )}
              >
                {row.name}
              </span>
              <span className="text-sm text-ink-faint">
                {row.who}
                <span className="sr-only">{`, ${stateWords[row.state]}`}</span>
              </span>
            </span>
            <span className="text-sm text-ink-faint tabular-nums">
              {row.length}
            </span>
          </li>
        ))}
      </ol>
      {footer ? (
        <p className="flex items-center justify-between border-t border-border pt-3 text-sm text-ink-muted">
          <span>{footer.label}</span>
          <span className="tabular-nums">{footer.value}</span>
        </p>
      ) : null}
    </TrainCard>
  );
}
