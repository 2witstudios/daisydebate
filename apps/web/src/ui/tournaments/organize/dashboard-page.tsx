import type {
  OrganizeDashboard,
  OrganizePhase,
} from '../../../features/tournaments/organize-dashboard';
import { tournamentRoutes } from '../../../features/tournaments/routes';
import { Badge } from '../../components/badge/badge';
import type { BadgeTone } from '../../components/badge/badge-class';
import { LinkButton } from '../link-button/link-button';
import { PageHeader } from '../../components/page-header/page-header';
import { PageFrame } from '../page-frame/page-frame';
import { StatusLine } from '../../components/status-line/status-line';

const phaseLabels: Readonly<Record<OrganizePhase, string>> = {
  draft: 'Draft',
  registration: 'Registration open',
  'in-progress': 'In progress',
  completed: 'Completed',
};

const phaseTones: Readonly<Record<OrganizePhase, BadgeTone>> = {
  draft: 'neutral',
  registration: 'accent',
  'in-progress': 'live',
  completed: 'neutral',
};

const card = 'flex flex-col gap-4 rounded-xl bg-surface p-6 shadow-1';
const h2 = 'text-xs font-bold tracking-widest text-ink-muted uppercase';

/** The organizer's home: what is running, what needs them, and create. */
export function DashboardPage({
  dashboard,
}: {
  readonly dashboard: OrganizeDashboard;
}) {
  return (
    <PageFrame>
      <PageHeader
        title="Organize"
        actions={
          <LinkButton href={tournamentRoutes.create} variant="primary">
            Create a tournament
          </LinkButton>
        }
      />
      <div className="flex items-start gap-6 max-rail:flex-col">
        <div className="flex min-w-0 flex-1 flex-col gap-6 max-rail:w-full">
          <ul className="grid grid-cols-3 gap-3 max-compact:grid-cols-1">
            {dashboard.counts.map((count) => (
              <li
                key={count.label}
                className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4"
              >
                <span className="text-sm text-ink-muted">{count.label}</span>
                <span className="font-display text-2xl font-bold text-ink tabular-nums">
                  {count.count}
                </span>
              </li>
            ))}
          </ul>
          <section aria-label="Your tournaments" className={card}>
            <h2 className={h2}>Your tournaments</h2>
            <ul>
              {dashboard.tournaments.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-border py-4 first:border-t-0 first:pt-0"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-md font-strong text-ink">
                        {item.name}
                      </span>
                      <Badge tone={phaseTones[item.phase]}>
                        {item.phase === 'in-progress' ? (
                          <StatusLine tone="live">
                            {phaseLabels[item.phase]}
                          </StatusLine>
                        ) : (
                          phaseLabels[item.phase]
                        )}
                      </Badge>
                    </div>
                    <span className="text-sm text-ink-muted">
                      {item.summary}
                    </span>
                    <span className="text-sm text-ink-faint">{item.note}</span>
                  </div>
                  <LinkButton href={item.action.href}>
                    {item.action.label}
                  </LinkButton>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <aside
          aria-label="Needs attention"
          className="flex w-rail shrink-0 flex-col gap-4 max-rail:w-full"
        >
          <section className={card}>
            <h2 className={h2}>Needs attention</h2>
            <ul>
              {dashboard.attention.map((item) => (
                <li
                  key={item.title}
                  className="flex flex-col gap-1 border-t border-border py-3 first:border-t-0 first:pt-0"
                >
                  <span className="text-base font-strong text-ink">
                    {item.title}
                  </span>
                  <span className="text-sm text-ink-muted">{item.detail}</span>
                  {item.action ? (
                    <a href={item.action.href} className="text-sm font-strong">
                      {item.action.label}
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </PageFrame>
  );
}
