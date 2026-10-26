import type { RoomView } from '@daisy/protocol';
import Link from 'next/link';
import type { RoomFormState } from '../../../features/rooms/command-answer';
import type { FormAction } from '../../form-action/form-action';
import { clockDuration } from '../../../features/rooms/duration-input';
import { buttonClass } from '../../components/button/button-class';
import { CommandForm } from './assembly-readiness';

function prepState(view: RoomView): string {
  const config = view.config.preRoundPrep;
  if (!config.enabled) return 'Off';
  if (!view.prep.startedAt)
    return `Optional · ${clockDuration(config.durationMs)} for both sides`;
  if (view.prep.finished) return 'Done';
  return view.prep.remainingMs === null
    ? 'Under way'
    : `${clockDuration(view.prep.remainingMs)} left`;
}

/** Prep before the round, inside the Start card: its length or live state, the host's controls, and the library. */
export function RoomPrep({
  view,
  action,
  commandIds,
}: {
  readonly view: RoomView;
  readonly action: FormAction<RoomFormState>;
  readonly commandIds: { readonly start: string; readonly finish: string };
}) {
  const command = (
    type: 'start-prep' | 'finish-prep',
    label: string,
    commandId: string,
  ) =>
    CommandForm({
      type,
      label,
      enabled: true,
      version: view.version,
      commandId,
      action,
      className: buttonClass('secondary'),
    });
  return (
    <section
      aria-labelledby="room-prep-title"
      className="flex min-w-0 flex-wrap items-center gap-3 border-t border-border pt-3"
    >
      <div className="min-w-0 flex-1">
        <h3 id="room-prep-title" className="text-sm font-semibold">
          Prep before the round
        </h3>
        <p role="status" className="text-sm text-ink-muted tabular-nums">
          {prepState(view)}
        </p>
      </div>
      <Link href="/prep" className={buttonClass('secondary')}>
        Prep library
      </Link>
      {view.capabilities.canStartPrep
        ? command('start-prep', 'Start prep', commandIds.start)
        : null}
      {view.capabilities.canFinishPrep
        ? command('finish-prep', 'End prep', commandIds.finish)
        : null}
    </section>
  );
}
