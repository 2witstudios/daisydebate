import type { RoomView } from '@daisy/protocol';

const refusals = {
  'not-eligible': 'yet: AI rounds are for approved beta testers.',
  allowance: 'until you have an AI round left this month.',
  capacity: 'right now: bots are busy, try again shortly.',
} as const;

export function BotAdmissionNotice({
  admission,
}: {
  readonly admission: RoomView['botAdmission'];
}) {
  if (!admission) return null;
  if (admission.kind === 'unavailable')
    return (
      <p role="status" className="text-sm text-ink-muted">
        A round with a bot debater can’t start right now: bots are unavailable.
      </p>
    );
  if (admission.kind === 'free')
    return (
      <p role="status" className="text-sm text-ink-muted">
        The AI judge is free: this round doesn’t use one of your AI rounds.
      </p>
    );
  return (
    <div role="status" className="text-sm text-ink-muted">
      {admission.refusal === 'not-eligible' ? null : (
        <>
          <p>
            {admission.remaining} of {admission.limit} AI rounds left this
            month, which ends {admission.periodEnd} (UTC).
          </p>
          <p>
            A bot debates in this round, so starting it uses one. If the bot
            fails before it speaks, you get it back. Availability is checked
            again when the round starts.
          </p>
        </>
      )}
      {admission.refusal ? (
        <p>
          A round with a bot debater can’t start {refusals[admission.refusal]}
        </p>
      ) : null}
    </div>
  );
}
