import { roundPositionAt } from '@daisy/debate-engine/position';
import {
  isNamedSeat,
  type RoundView,
  type RoundSeat,
  type RoundPosition,
  type RoundCommandEnvelope,
} from '@daisy/protocol';
export type RoundControlIntent = {
  readonly type: RoundCommandEnvelope['command']['type'];
  readonly label: string;
  readonly participantId?: string;
  readonly enabled: boolean;
  readonly confirm?: boolean;
};
const own = (
  self: RoundSeat,
  type: RoundControlIntent['type'],
  label: string,
  enabled = true,
  confirm = false,
): RoundControlIntent => ({
  type,
  label,
  participantId: self.id,
  enabled,
  confirm,
});
function canPrep(view: RoundView, position: RoundPosition, self: RoundSeat) {
  const next = position.nextSegment,
    prep = view.rules.inRoundPrep;
  if (!next || !prep) return false;
  const segment = view.rules.segments[next.sequence]!;
  if (
    prep.expiresAtSegment !== null &&
    view.rules.segments.findIndex((s) => s.key === prep.expiresAtSegment) <=
      next.sequence
  )
    return false;
  return (
    segment.side === self.role &&
    segment.slot === self.slot &&
    prep.spendableBefore.includes(segment.type) &&
    (position.prepBudgetRemainingMs?.[segment.side] ?? 0) > 0
  );
}
function canInterrupt(
  view: RoundView,
  open: NonNullable<RoundPosition['openSegment']>,
  holder: string | undefined,
  self: RoundSeat,
) {
  const policy = view.rules.interaction.interruptions;
  return (
    holder !== self.id &&
    policy !== null &&
    policy.allowed !== 'disabled' &&
    open.remainingMs >= policy.minRemainingMs
  );
}
function openIntents(
  view: RoundView,
  open: NonNullable<RoundPosition['openSegment']>,
  self: RoundSeat,
) {
  const scheduled = view.rules.segments[open.sequence]!;
  const holder =
    open.floorParticipantId ??
    view.participants
      .filter(isNamedSeat)
      .find((p) => p.role === scheduled.side && p.slot === scheduled.slot)?.id;
  const result: RoundControlIntent[] = [];
  if (holder === self.id)
    result.push(
      own(
        self,
        'yield',
        'End speech',
        view.rules.interaction.yield?.allowed === true,
        true,
      ),
    );
  if (
    open.type === 'cross_ex' ||
    view.rules.interaction.interruptions?.allowed === 'enabled'
  )
    result.push(
      own(
        self,
        'interrupt',
        'Interrupt',
        canInterrupt(view, open, holder, self),
      ),
    );
  return result;
}
function activeIntents(
  view: RoundView,
  position: RoundPosition,
  self: RoundSeat,
): readonly RoundControlIntent[] {
  if (position.awaitingBallot) return [];
  const forfeit = own(self, 'forfeit', 'Forfeit round', true, true);
  if (position.prep?.side === self.role)
    return [
      own(
        self,
        'start_speech',
        `Start ${position.nextSegment?.key ?? 'speech'}`,
      ),
      forfeit,
    ];
  if (position.openSegment)
    return [...openIntents(view, position.openSegment, self), forfeit];
  return canPrep(view, position, self)
    ? [own(self, 'start_prep', 'Use prep'), forfeit]
    : [forfeit];
}
/** Display hints only: every command rechecks locked authority and the engine. */
export function roundControlIntents(
  view: RoundView,
  actorId: string,
  nowMs: number,
): readonly RoundControlIntent[] {
  // Start is host-only, whatever seat the host holds.
  if (view.status === 'scheduled')
    return view.viewerIsHost
      ? [{ type: 'start', label: 'Start round', enabled: true }]
      : [];
  const self = view.participants
    .filter(isNamedSeat)
    .find(
      (p) => p.actorId === actorId && p.kind === 'human' && p.role !== 'judge',
    );
  if (!self) return [];
  if (view.status !== 'active' || view.checkpoint === null) return [];
  return activeIntents(
    view,
    roundPositionAt({
      round: view,
      rules: view.rules,
      segments: view.segments,
      checkpoint: view.checkpoint,
      nowMs,
    }),
    self,
  );
}
