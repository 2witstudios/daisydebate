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
        Bot Round cannot launch while admission is unavailable.
      </p>
    );
  return (
    <div role="status" className="text-sm text-ink-muted">
      <p>
        {admission.remaining} of {admission.limit} bot Round allowances remain
        in your current period, ending {admission.periodEnd} (UTC).
      </p>
      <p>
        Launching reserves one allowance from you as host. The first model call
        counts it; a vendor failure that aborts the run refunds it. Availability
        is checked again at launch.
      </p>
      {admission.refusal ? (
        <p>
          Bot Round cannot launch{' '}
          {admission.refusal === 'allowance'
            ? 'until allowance is available.'
            : 'while admission is unavailable.'}
        </p>
      ) : null}
    </div>
  );
}
