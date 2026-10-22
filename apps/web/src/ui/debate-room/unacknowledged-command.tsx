import { HiddenFields } from '../form-action/hidden-fields';
import type { RoundFormState } from '../../features/round-runtime/command-form';
import { roundCommandFields } from '../../features/round-runtime/command-fields';
const fields = new Set([
  'version',
  'commandId',
  'expectedVersion',
  'type',
  'participantId',
  'confirmed',
]);
/** Only the unresolved original envelope can be retried; fresh intent hints cannot replace it. */
export function UnacknowledgedCommand({
  answer,
  post,
  pending,
}: {
  readonly answer: RoundFormState;
  readonly post: (form: FormData) => void;
  readonly pending: boolean;
}) {
  if (
    !answer.unacknowledged ||
    !roundCommandFields(Object.entries(answer.values), true)
  )
    return null;
  return (
    <form
      action={post}
      aria-label="Retry unacknowledged command"
      aria-busy={pending}
      className="px-4 py-2"
    >
      <HiddenFields
        entries={Object.entries(answer.values).filter(([name]) =>
          fields.has(name),
        )}
      />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-room-target items-center rounded-sm border border-border-strong px-4 text-sm font-strong disabled:opacity-60"
      >
        {pending ? 'Retrying…' : 'Retry command'}
      </button>
    </form>
  );
}
