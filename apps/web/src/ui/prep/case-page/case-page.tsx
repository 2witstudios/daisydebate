import type { CaseView } from '../../../features/prep/case-view';
import { inertActions } from '../../../features/prep/actions';
import { Badge } from '../../components/badge/badge';
import { Breadcrumb } from '../breadcrumb/breadcrumb';
import { InertActionButton } from '../inert-action/inert-action';
import { PrepIcon } from '../prep-icon/prep-icon';
import { PrepTabs } from '../prep-tabs/prep-tabs';
import { CaseCompare } from './case-compare';
import { CaseCompose } from './case-compose';
import { CaseExport } from './case-export';
import { CaseLibraryPanel } from './case-library';
import { CaseVersions } from './case-versions';

/** The case builder: compose speeches, compare versions, export. */
export function CasePage({ view }: { readonly view: CaseView }) {
  const { case: c } = view;
  const latest = c.versions[0]?.version ?? 0;
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-4 px-6 pt-5 pb-8 max-compact:px-4">
      <Breadcrumb
        crumbs={[
          { label: 'Prep', href: '/prep' },
          { label: 'Cases', href: '/prep?view=cases' },
          { label: c.title },
        ]}
      />
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
          {c.title}
        </h1>
        {c.draft === null ? (
          <Badge tone="neutral">{`v${latest}`}</Badge>
        ) : (
          <Badge tone="gold">{`Draft on v${latest}`}</Badge>
        )}
        <span className="ml-auto inline-flex items-center gap-2 text-sm text-ink-muted">
          <PrepIcon name="lock" size={14} />
          {c.visibility.kind === 'team'
            ? `Shared with ${c.visibility.teamName}: ${c.sharedRight}`
            : 'Private to you'}
        </span>
        <InertActionButton action={inertActions.shareCase} symbol="share" />
      </header>
      <div className="flex gap-6 max-rail:flex-col">
        <CaseLibraryPanel view={view} />
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <PrepTabs
            label="Case view"
            current={view.query.view}
            tabs={view.tabs.map((t) => ({
              id: t.id,
              label: t.label,
              href: t.href,
            }))}
          />
          {view.query.view === 'compose' ? <CaseCompose view={view} /> : null}
          {view.query.view === 'compare' ? <CaseCompare view={view} /> : null}
          {view.query.view === 'export' ? <CaseExport view={view} /> : null}
        </div>
        <CaseVersions view={view} />
      </div>
    </div>
  );
}
