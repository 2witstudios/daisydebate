import { readAuditPage, verifyStoredChain } from '../../audit/store';
import { chainBadge } from '../../audit/badge';
import { requireOperator } from '../../server/operator-gate';
import { adminRuntime } from '../../server/runtime';
import { NotPermitted, OperatorNav } from '../operator-nav';

export const dynamic = 'force-dynamic';
const pageSize = 50;

export default async function AuditPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly before?: string }>;
}) {
  const { operator, allowed } = await requireOperator('audit.read');
  const nav = <OperatorNav name={operator.displayName} />;
  if (!allowed)
    return (
      <>
        {nav}
        <NotPermitted />
      </>
    );
  const { db } = adminRuntime().database;
  const before = Number((await searchParams).before);
  const rows = await readAuditPage(db, {
    limit: pageSize,
    ...(Number.isSafeInteger(before) && before > 0 ? { before } : {}),
  });
  const badge = chainBadge(await verifyStoredChain(db));
  const oldest = rows.at(-1)?.seq;
  return (
    <>
      {nav}
      <h1>Audit</h1>
      <p
        className={badge.ok ? 'badge-ok' : 'badge-bad'}
        data-testid="chain-badge"
      >
        {badge.text}
      </p>
      <table>
        <thead>
          <tr>
            <th>Seq</th>
            <th>When (UTC)</th>
            <th>Event</th>
            <th>Detail</th>
            <th>Operator</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.seq}>
              <td>{row.seq}</td>
              <td>{row.at}</td>
              <td>{row.kind}</td>
              <td>{row.detail ?? ''}</td>
              <td>{row.operatorId ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === pageSize && oldest !== undefined && oldest > 1 ? (
        <p>
          <a href={`/audit?before=${oldest}`}>Older events</a>
        </p>
      ) : null}
    </>
  );
}
