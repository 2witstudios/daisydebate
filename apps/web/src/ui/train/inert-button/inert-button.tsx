import { buttonClass } from '../../components/button/button-class';
import { SampleAction } from '../../components/sample-action/sample-action';
import { cn } from '../../cn';

export type InertButtonProps = {
  readonly children: string;
  readonly className?: string;
};

/**
 * A control with no backend: it answers on the same page with the
 * sample-action banner, worded by its own label.
 */
export function InertButton({ children, className }: InertButtonProps) {
  return (
    <SampleAction
      label={children}
      className={cn(buttonClass('ghost'), className)}
    >
      {children}
    </SampleAction>
  );
}
