import Link from 'next/link';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';
import { Panel } from '../../components/panel/panel';

export type ComingSoonCardProps = {
  readonly title: string;
  /** The destination's public explainer. */
  readonly href: string;
};

/**
 * A dashboard card for a destination that is not open yet. It leaves the
 * dashboard when the destination launches.
 */
export function ComingSoonCard({ title, href }: ComingSoonCardProps) {
  return (
    <Panel title={title} action={<Badge tone="accent">Coming soon</Badge>}>
      <Link
        href={href}
        className={cn(
          buttonClass('secondary'),
          'no-underline hover:no-underline',
        )}
      >
        Learn more
      </Link>
    </Panel>
  );
}
