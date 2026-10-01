import type { InertAction } from '../../../features/train/actions';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';

export type InertButtonProps = {
  readonly action: InertAction;
  readonly children: string;
  readonly className?: string;
};

/**
 * A control whose operation does not exist yet. It is disabled, says why to
 * everyone (title and text for readers), and the reason lives in the feature's
 * `actions.ts` with the operation that will replace it.
 */
export function InertButton({ action, children, className }: InertButtonProps) {
  return (
    <button
      type="button"
      disabled
      title={action.reason}
      className={cn(buttonClass('ghost'), className)}
    >
      {children}
      <span className="sr-only">{`. ${action.reason}`}</span>
    </button>
  );
}
