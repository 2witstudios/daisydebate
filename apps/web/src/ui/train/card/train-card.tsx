import type { ReactNode } from 'react';
import { Badge } from '../../components/badge/badge';
import { cn } from '../../cn';

export type TrainCardProps = {
  readonly title: string;
  /** Heading level: a page section is 2, a card inside one is 3. */
  readonly level?: 2 | 3;
  /** Marks content that is sample logic or sample data. */
  readonly sample?: boolean;
  readonly children: ReactNode;
  readonly className?: string;
};

/** A titled surface; the repeated frame of every Train screen. */
export function TrainCard({
  title,
  level = 2,
  sample = false,
  children,
  className,
}: TrainCardProps) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <section
      className={cn(
        'flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-1',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Heading className="flex-1 text-md font-strong text-ink">
          {title}
        </Heading>
        {sample ? <Badge>Sample</Badge> : null}
      </div>
      {children}
    </section>
  );
}
