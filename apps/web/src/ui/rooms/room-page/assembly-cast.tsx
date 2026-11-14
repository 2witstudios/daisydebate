import { AssemblyCommandForm } from './assembly-command-form';
import type { RoomFormState } from '../../../features/rooms/command-answer';
import type { FormAction } from '../../form-action/form-action';
import {
  aiRoleFits,
  isJudgeSeat,
  isNamedSeat,
  sameSeat,
  seatKey,
  type RoomCastChoice,
  type RoomView,
  type SeatRef,
} from '@daisy/protocol';
import { aiJudgeSeatable } from './ai-judge-notice';
import { declaredSeats, seatLabel } from './assembly-controls';
import { AssemblyCommandFields } from './assembly-command-fields';
import { buttonClass } from '../../components/button/button-class';
import { controlClass } from '../../components/form-field/form-field-class';

type Seat = SeatRef;

/**
 * The AI actors a seat may hold: a bot debater for a side's or a speaker's
 * seat, the AI judge for a judge's, and none for a moderator's.
 */
export const botsForSeat = (
  bots: readonly RoomCastChoice[],
  seat: SeatRef,
): readonly RoomCastChoice[] =>
  bots.filter((bot) => aiRoleFits(bot.aiRole, seat));
export type IntentIds = {
  readonly claim: string;
  readonly assign: string;
  readonly remove: string;
  readonly ai: string;
};
export type CastProps = {
  readonly view: RoomView;
  readonly viewer: { readonly actorId: string; readonly label: string };
  readonly bots: readonly RoomCastChoice[];
  readonly action: FormAction<RoomFormState>;
  readonly commandIds: readonly IntentIds[];
};

function SeatActions({
  props,
  seat,
  ids,
}: {
  readonly props: CastProps;
  readonly seat: Seat;
  readonly ids: IntentIds;
}) {
  const { view, action } = props;
  const occupant = view.participants.find((member) =>
    sameSeat(member.seat, seat),
  );
  const label = seatLabel(view.rules.sides, seat);
  const fieldId = `assign-${seatKey(seat).replace(':', '-')}`;
  const targets = [
    ...new Map(
      [
        props.viewer,
        ...view.participants
          .filter(isNamedSeat)
          .filter((member) => member.kind === 'human'),
      ].map((member) => [member.actorId, member]),
    ).values(),
  ];
  return (
    <fieldset className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-4">
      <legend>{label}</legend>
      {view.capabilities.host ? (
        <AssemblyCommandForm
          key={
            occupant && isNamedSeat(occupant)
              ? occupant.actorId
              : occupant
                ? 'anonymous'
                : 'empty'
          }
          action={action}
          className="flex gap-2"
        >
          {(state) => {
            const saved =
              occupant && isNamedSeat(occupant) ? occupant.actorId : '';
            const selected = state.error
              ? (state.values.actorId ?? saved)
              : saved;
            return (
              <>
                <AssemblyCommandFields
                  type="assign-seat"
                  version={view.version}
                  commandId={ids.assign}
                />
                <input type="hidden" name="seat" value={JSON.stringify(seat)} />
                <label className="sr-only" htmlFor={fieldId}>
                  Assign {label}
                </label>
                <select
                  key={selected}
                  defaultValue={selected}
                  required
                  disabled={Boolean(occupant && !isNamedSeat(occupant))}
                  id={fieldId}
                  name="actorId"
                  className={controlClass}
                >
                  <option value="" disabled>
                    {occupant && !isNamedSeat(occupant)
                      ? 'Judge'
                      : 'Choose participant'}
                  </option>
                  {occupant &&
                  isNamedSeat(occupant) &&
                  !targets.some(
                    (target) => target.actorId === occupant.actorId,
                  ) &&
                  !props.bots.some(
                    (bot) => bot.actorId === occupant.actorId,
                  ) ? (
                    <option value={occupant.actorId} disabled>
                      {occupant.label}
                      {occupant.kind === 'bot' ? ' · AI' : ''} · unavailable
                    </option>
                  ) : null}
                  {targets.map((member) => (
                    <option key={member.actorId} value={member.actorId}>
                      {member.label}
                    </option>
                  ))}
                  {botsForSeat(props.bots, seat).map((bot) => {
                    const premium =
                      isJudgeSeat(seat) &&
                      !aiJudgeSeatable(view.aiJudgeSeating);
                    const ranked =
                      view.competitionType === 'ranked' && !isJudgeSeat(seat);
                    return (
                      <option
                        key={bot.actorId}
                        value={bot.actorId}
                        disabled={!bot.eligible || premium || ranked}
                      >
                        {bot.label} · AI
                        {premium
                          ? ' · premium'
                          : ranked
                            ? ' · ranked rooms seat people'
                            : !bot.eligible
                              ? ' · unavailable'
                              : ''}
                      </option>
                    );
                  })}
                </select>
                <button
                  type="submit"
                  disabled={Boolean(occupant && !isNamedSeat(occupant))}
                  className={buttonClass('secondary')}
                >
                  Assign
                </button>
              </>
            );
          }}
        </AssemblyCommandForm>
      ) : null}
      {view.capabilities.host && occupant && isNamedSeat(occupant) ? (
        <AssemblyCommandForm action={action}>
          <AssemblyCommandFields
            type="remove-seat"
            version={view.version}
            commandId={ids.remove}
          />
          <input type="hidden" name="participantId" value={occupant.id} />
          <button type="submit" className={buttonClass('secondary')}>
            Remove {occupant.label}
          </button>
        </AssemblyCommandForm>
      ) : null}
    </fieldset>
  );
}

/** Host assignment and removal for every declared seat. */
export function AssemblyCast(props: CastProps) {
  return (
    <section aria-label="Seat controls" className="flex flex-col gap-3">
      {declaredSeats(props.view.rules).map((seat, index) => {
        const ids = props.commandIds[index];
        if (!ids) throw new Error('Missing Room seat command identities');
        return (
          <SeatActions
            key={seatKey(seat)}
            props={props}
            seat={seat}
            ids={ids}
          />
        );
      })}
    </section>
  );
}
