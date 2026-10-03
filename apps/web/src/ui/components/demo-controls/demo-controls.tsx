import Link from 'next/link';
import { buttonClass } from '../button/button-class';
import { cn } from '../../cn';

/**
 * Controls that stand in for what a backend would do (other people acting in
 * a room, a clock moving on). Each is a link to the next state, set apart
 * from the page's own controls by a dashed edge.
 */
export function DemoControls({
  blurb,
  items,
}: {
  readonly blurb: string;
  readonly items: readonly { readonly label: string; readonly href: string }[];
}) {
  return (
    <section
      aria-label="Demo controls"
      className="flex flex-col gap-3 rounded-xl border border-dashed border-border-strong p-5"
    >
      <h2 className="text-sm font-strong text-ink">Demo controls</h2>
      <p className="text-sm text-ink-muted">{blurb}</p>
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={item.label}>
            <Link
              href={item.href}
              className={cn(
                buttonClass('ghost'),
                'text-sm no-underline hover:no-underline',
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
