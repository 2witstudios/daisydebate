import Link from 'next/link';
import { judgeRoutes } from '../../../features/judge/routes';
import type { JudgeResource } from '../../../features/judge/resources';
import { Icon } from '../../components/icon/icon';
import { resourceIcon } from './resource-icon';

export type ResourceListProps = {
  /** The resources to list, already narrowed to the hub's short list. */
  readonly resources: readonly JudgeResource[];
};

const row =
  'flex min-h-12 items-center gap-3 border-t border-border px-5 text-md font-strong text-ink no-underline first:border-t-0 hover:bg-surface-overlay hover:no-underline';

/** The hub's short list of resources; each row opens the full page. */
export function ResourceList({ resources }: ResourceListProps) {
  return (
    <section
      aria-label="Resources"
      className="overflow-hidden rounded-xl bg-surface shadow-1"
    >
      <h2 className="px-5 pt-5 pb-3 text-xl font-bold">Resources</h2>
      <ul>
        {resources.map((resource) => (
          <li key={resource.kind}>
            <Link href={judgeRoutes.resources} className={row}>
              <Icon
                name={resourceIcon(resource.kind)}
                className="text-accent"
              />
              <span className="grow">{resource.title}</span>
              <span aria-hidden="true" className="text-ink-faint">
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="border-t border-border px-5 py-2">
        <Link
          href={judgeRoutes.resources}
          className="inline-flex min-h-12 items-center gap-2 text-md font-strong text-accent no-underline hover:no-underline"
        >
          All resources
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}
