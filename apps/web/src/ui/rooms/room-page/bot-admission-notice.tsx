import type { RoomView } from '@daisy/protocol';

const refusals = {
  'not-eligible': 'because access is unavailable.',
  'renewal-grace': 'until your subscription payment is restored.',
  allowance: 'because your bot debate allowance is used.',
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
  return (
    <div role="status" className="text-sm text-ink-muted">
      {admission.refusal === 'not-eligible' ? null : (
        <>
          <p>
            {admission.remaining} of {admission.limit} bot debates remaining
            {admission.source?.kind === 'lifetime'
              ? ' in your lifetime free allowance.'
              : admission.source
                ? ` in this ${admission.source.kind === 'beta' ? 'beta month' : 'billing period'}, ending ${admission.source.endsAt} (UTC).`
                : '.'}
          </p>
          <p>
            Starting reserves one bot debate. It counts at the first model call.
            Definite provider failure or a qualifying platform failure restores
            it; an unknown result stays counted. Availability is checked when
            the round starts.
          </p>
        </>
      )}
      {admission.refusal ? (
        <p>
          A round with a bot debater can’t start {refusals[admission.refusal]}
        </p>
      ) : null}
      {admission.refusal === 'allowance' ||
      admission.refusal === 'renewal-grace' ? (
        <a href="/settings/billing" className="underline">
          {admission.refusal === 'renewal-grace'
            ? 'Manage billing'
            : 'View plan and usage'}
        </a>
      ) : null}
    </div>
  );
}
