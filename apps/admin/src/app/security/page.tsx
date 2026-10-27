import Link from 'next/link';
import { systemClock } from '@daisy/clock';
import {
  sections,
  securityViews,
  type Section,
  type SecurityView,
} from '../../features/security/sections';
import type { Row, SecurityStore } from '../../features/security/store';
import {
  coverageFloor,
  coverageOf,
  securityHref,
  securityQuery,
  securityWindows,
  windowBounds,
  type SecurityWindow,
} from '../../features/security/view';
import { requireOperator } from '../../server/operator-gate';
import { adminRuntime } from '../../server/runtime';
import { NotPermitted, OperatorNav } from '../operator-nav';

export const dynamic = 'force-dynamic';

const viewLabel: Readonly<Record<SecurityView, string>> = {
  auth: 'Auth',
  operator: 'Operator',
  realtime: 'Realtime closes',
  invariants: 'Invariants',
  errors: 'Errors',
};
const windowLabel: Readonly<Record<SecurityWindow, string>> = {
  '1h': 'Last hour',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '28d': 'Last 28 days',
};
const unreachable = (
  <p role="alert" className="badge-bad">
    The log store could not be read. Nothing below is a count of zero; try
    again.
  </p>
);

function SectionTable({
  section,
  rows,
}: {
  readonly section: Section;
  readonly rows: readonly Row[];
}) {
  return (
    <>
      <h2>{section.title}</h2>
      {rows.length === 0 ? (
        <p>None in this window.</p>
      ) : (
        <table>
          <thead>
            <tr>
              {section.columns.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {section.columns.map((column) => (
                  <td key={column.key}>{row[column.key] ?? '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/** Coverage first: zero events never reads as a healthy pipeline. */
async function CoverageBanner({
  store,
  now,
}: {
  readonly store: SecurityStore;
  readonly now: string;
}) {
  const read = await store.coverage(coverageFloor(now));
  if (read.kind === 'unreachable') return unreachable;
  const { heartbeat, apps, oldest } = read.value;
  const coverage = coverageOf({
    now,
    heartbeat: heartbeat as Parameters<typeof coverageOf>[0]['heartbeat'],
    oldest: oldest as readonly { readonly oldest: string }[],
  });
  return (
    <section aria-label="Coverage" data-testid="coverage">
      <p className={coverage.shipper === 'live' ? 'badge-ok' : 'badge-bad'}>
        {coverage.shipper === 'live'
          ? `Shipper live (${coverage.reconnects ?? 0} reconnects since start). Counts are lower bounds: records published while it is disconnected are not seen.`
          : coverage.shipper === 'stale'
            ? `Coverage unknown: the shipper's last heartbeat is stale or ${coverage.natsState ?? 'unknown'}. Counts below may be incomplete.`
            : 'Coverage unknown: no shipper heartbeat in the last day. Counts below may be incomplete.'}
      </p>
      <p className={coverage.retention === 'ok' ? 'muted' : 'badge-bad'}>
        {coverage.retention === 'ok'
          ? 'Retention: every stored row is under 29 days old.'
          : 'Retention overdue: a stored row is older than 29 days. Check the partition sweep (docs/operations/log-pipeline.md).'}
      </p>
      <p className="muted">
        Last line received:{' '}
        {apps.length === 0
          ? 'none in the last day'
          : apps.map((row) => `${row.app} ${row.last_received}`).join('; ')}
      </p>
    </section>
  );
}

export default async function SecurityPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, unknown>>>;
}) {
  const { operator, allowed } = await requireOperator('security.read');
  const nav = <OperatorNav name={operator.displayName} />;
  if (!allowed)
    return (
      <>
        {nav}
        <NotPermitted />
      </>
    );
  const query = securityQuery(await searchParams);
  const { security } = adminRuntime();
  if (!security)
    return (
      <>
        {nav}
        <h1>Security</h1>
        <p role="status">
          The log store is not configured (CLICKHOUSE_URL and
          CLICKHOUSE_READER_PASSWORD).
        </p>
      </>
    );
  const now = systemClock.now();
  const result = await security.view(
    query.view,
    windowBounds(now, query.window),
  );
  return (
    <>
      {nav}
      <h1>Security</h1>
      <CoverageBanner store={security} now={now} />
      <nav aria-label="Security views">
        {securityViews.map((view) => (
          <Link
            key={view}
            href={securityHref({ view, window: query.window })}
            aria-current={view === query.view ? 'page' : undefined}
          >
            {viewLabel[view]}
          </Link>
        ))}
      </nav>
      <form method="get" action="/security">
        <input type="hidden" name="view" value={query.view} />
        <label>
          Window{' '}
          <select name="window" defaultValue={query.window}>
            {securityWindows.map((window) => (
              <option key={window} value={window}>
                {windowLabel[window]}
              </option>
            ))}
          </select>
        </label>{' '}
        <button type="submit">Show</button>
      </form>
      {result.kind === 'ok'
        ? sections[query.view].map((section, index) => (
            <SectionTable
              key={section.title}
              section={section}
              rows={result.value[index] ?? []}
            />
          ))
        : unreachable}
    </>
  );
}
