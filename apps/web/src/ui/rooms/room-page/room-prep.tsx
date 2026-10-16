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
  if (!view.prep.startedAt) return clockDuration(config.durationMs);
  if (view.prep.finished) return 'Finished';
  return view.prep.remainingMs === null
    ? 'In progress'
    : `${clockDuration(view.prep.remainingMs)} remaining`;
}

/** Pre-round preparation: its saved length or live state, the host's controls, and the library. */
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
      className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
    >
      <div className="min-w-0 flex-1">
        <h2 id="room-prep-title" className="font-semibold">
          Preparation
        </h2>
        <p role="status" className="text-sm text-ink-muted tabular-nums">
          {prepState(view)}
        </p>
      </div>
      <Link href="/prep" className={buttonClass('secondary')}>
        Prep library
      </Link>
      {view.capabilities.canStartPrep
        ? command('start-prep', 'Start preparation', commandIds.start)
        : null}
      {view.capabilities.canFinishPrep
        ? command('finish-prep', 'Finish preparation', commandIds.finish)
        : null}
    </section>
  );
}
