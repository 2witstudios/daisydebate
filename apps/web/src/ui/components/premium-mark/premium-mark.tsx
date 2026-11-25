import { cn } from '../../cn';
import { DaisyMark } from '../daisy-mark/daisy-mark';

/**
 * The Premium mark: the Daisy bloom in one colour, gold. The logo is always
 * forest, sage and yolk, so a gold bloom means Premium and nothing else.
 * With a `label` it is an image that says so; without one it decorates text
 * that already does. A screen carries one offer (ADR 0933).
 */
export function PremiumMark({
  size = 16,
  label,
  className,
}: {
  readonly size?: number;
  readonly label?: string;
  readonly className?: string;
}) {
  return (
    <span
      {...(label === undefined
        ? { 'aria-hidden': true }
        : { role: 'img', 'aria-label': label })}
      className={cn('inline-flex shrink-0 text-gold', className)}
    >
      <DaisyMark size={size} variant="mono" />
    </span>
  );
}
