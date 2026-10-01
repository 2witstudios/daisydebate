import { resourceAction } from '../../../features/judge/actions';
import type { JudgeResource } from '../../../features/judge/resources';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { BackLink } from '../back-link/back-link';
import { Notice } from '../notice/notice';
import { PageHeader } from '../../components/page-header/page-header';
import { resourceIcon } from '../resource-list/resource-icon';

export type ResourcesPageProps = {
  readonly resources: readonly JudgeResource[];
};

function ResourceCard({ resource }: { readonly resource: JudgeResource }) {
  const action = resourceAction(resource);
  const tint = resource.neededToQualify
    ? 'bg-gold-soft text-gold'
    : 'bg-accent-soft text-accent';
  return (
    <li className="flex flex-col gap-3 rounded-xl bg-surface p-6 shadow-1">
      <div className="flex items-center justify-between gap-3">
        <span
          className={`inline-flex size-12 items-center justify-center rounded-md ${tint}`}
        >
          <Icon name={resourceIcon(resource.kind)} size={22} />
        </span>
        {resource.neededToQualify ? (
          <Badge tone="gold">Needed to qualify</Badge>
        ) : null}
      </div>
      <h2 className="text-xl leading-tight font-bold">{resource.title}</h2>
      <p className="text-md leading-normal text-ink-muted">{resource.blurb}</p>
      <p className="text-sm text-ink-faint">{resource.meta}</p>
      <button
        type="button"
        disabled
        aria-describedby={`${resource.kind}-reason`}
        className={`${buttonClass('secondary')} self-start`}
      >
        {resource.cta}
      </button>
      <p id={`${resource.kind}-reason`} className="text-sm text-ink-faint">
        {action.reason}
      </p>
    </li>
  );
}

/** Everything a judge can read or practise before and between debates. */
export function ResourcesPage({ resources }: ResourcesPageProps) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <BackLink />
      <PageHeader
        title="Judging resources"
        lede="Everything you need to judge fairly. New judges start with the guide and practice judging."
      />
      <ul className="grid grid-cols-3 gap-4 max-reflow:grid-cols-2 max-compact:grid-cols-1">
        {resources.map((resource) => (
          <ResourceCard key={resource.kind} resource={resource} />
        ))}
      </ul>
      <Notice
        tone="accent"
        icon="eye"
        title="Ratings stay hidden while you judge"
      >
        Guides and examples use sample names. Nothing here shows a real
        debater’s rating or record.
      </Notice>
    </div>
  );
}
