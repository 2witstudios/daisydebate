import type { RoomView } from '@daisy/protocol';
import Link from 'next/link';
import { destinationHref } from '../../../features/coming-soon/launch';
import type { RoomFormState } from '../../../features/rooms/command-answer';
import type { FormAction } from '../../form-action/form-action';
import { clockDuration } from '../../../features/rooms/duration-input';
import { buttonClass } from '../../components/button/button-class';
import { CommandForm } from './assembly-readiness';

/** A strike with no prep after it: before the draw, while striking, then revealed. */
function strikeState(view: RoomView): string {
  if (!view.resolutionDraw)
    return 'Once everyone is Ready, draw the resolutions and strike to one';
  return view.resolutionDraw.revealedAt
    ? 'Resolution chosen · start the round when the room is ready'
    : 'The debaters are striking';
}

function prepState(view: RoomView): string {
  const config = view.config.preRoundPrep;
  const draw = view.config.resolutionDraw.enabled;
  if (!config.enabled) return draw ? strikeState(view) : 'Off';
  if (!view.prep.startedAt)
    return draw
      ? `${clockDuration(config.durationMs)} for both sides, starting when the resolution is chosen`
      : `Optional · ${clockDuration(config.durationMs)} for both sides`;
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
    type: 'start-pre-round' | 'finish-prep',
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
          {view.config.preRoundPrep.enabled
            ? 'Prep before the round'
            : 'Resolution strike'}
        </h3>
        <p role="status" className="text-sm text-ink-muted tabular-nums">
          {prepState(view)}
        </p>
      </div>
      <Link href={destinationHref('prep')} className={buttonClass('secondary')}>
        Prep library
      </Link>
      {view.capabilities.canStartPreRound
        ? command(
            'start-pre-round',
            view.config.resolutionDraw.enabled
              ? 'Draw the resolutions'
              : 'Start prep',
            commandIds.start,
          )
        : null}
      {view.capabilities.canFinishPrep
        ? command('finish-prep', 'End prep', commandIds.finish)
        : null}
    </section>
  );
}
