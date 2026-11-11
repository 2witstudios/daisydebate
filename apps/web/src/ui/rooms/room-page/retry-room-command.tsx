import type { FormValues } from '../../../features/forms/form-state';
import { buttonClass } from '../../components/button/button-class';
import { HiddenFields } from '../../form-action/hidden-fields';

/**
 * Stands in for a room command's controls while its answer is unknown: the
 * only thing left to post is the original command, field for field, so its
 * identifier lets the Room recognize one it already recorded.
 */
export function RetryRoomCommand({
  values,
  pending,
}: {
  readonly values: FormValues;
  readonly pending: boolean;
}) {
  return (
    <>
      <HiddenFields
        entries={Object.entries(values).filter(
          // React adds its own action fields to every post.
          ([name]) => !name.startsWith('$ACTION_'),
        )}
      />
      <button type="submit" className={buttonClass('secondary')}>
        {pending ? 'Retrying…' : 'Retry command'}
      </button>
    </>
  );
}
