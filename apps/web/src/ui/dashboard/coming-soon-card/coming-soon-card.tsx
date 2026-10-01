import Link from 'next/link';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';
import { Panel } from '../../components/panel/panel';

export type ComingSoonCardProps = {
  readonly title: string;
  readonly body: string;
  /** The destination's public explainer. */
  readonly href: string;
};

/**
 * A dashboard card for a destination that is not open yet, standing where its
 * live version (featured tournament, live debates) goes once it launches.
 */
export function ComingSoonCard({ title, body, href }: ComingSoonCardProps) {
  return (
    <Panel title={title} action={<Badge tone="accent">Coming soon</Badge>}>
      <div className="flex flex-col items-start gap-4">
        <p className="text-base text-ink-muted">{body}</p>
        <Link
          href={href}
          className={cn(
            buttonClass('secondary'),
            'no-underline hover:no-underline',
          )}
        >
          Learn more
        </Link>
      </div>
    </Panel>
  );
}
