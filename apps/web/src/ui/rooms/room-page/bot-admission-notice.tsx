import type { RoomView } from '@daisy/protocol';
export function BotAdmissionNotice({
  admission,
}: {
  readonly admission: RoomView['botAdmission'];
}) {
  if (!admission) return null;
  if (admission.kind === 'unavailable')
    return (
      <p role="status" className="text-sm text-ink-muted">
        A round with a bot can’t start right now: bots are unavailable.
      </p>
    );
  return (
    <div role="status" className="text-sm text-ink-muted">
      <p>
        {admission.remaining} of {admission.limit} bot rounds left in your
        current period, which ends {admission.periodEnd} (UTC).
      </p>
      <p>
        Starting the round uses one of them. If the bot fails before it speaks,
        you get it back. Availability is checked again when the round starts.
      </p>
      {admission.refusal ? (
        <p>
          A round with a bot can’t start{' '}
          {admission.refusal === 'allowance'
            ? 'until you have a bot round left.'
            : 'right now: bots are unavailable.'}
        </p>
      ) : null}
    </div>
  );
}
