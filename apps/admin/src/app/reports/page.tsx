import { reportReasonLabels } from '@daisy/protocol';
import { requireOperator } from '../../server/operator-gate';
import { adminRuntime } from '../../server/runtime';
import { NotPermitted, OperatorNav } from '../operator-nav';
import { liftRestrictionAction, resolveReportAction } from './actions';

const notices: Readonly<Record<string, string>> = {
  resolved: 'Report closed.',
  lifted: 'Restriction lifted.',
  denied: 'Your operator role does not permit that.',
  refused: 'That was refused; it may already be closed.',
  unknown: 'The outcome is unknown. Check the queue before trying again.',
  days: 'A suspension needs a length from 1 to 365 days.',
};

const when = (iso: string) => iso.slice(0, 16).replace('T', ' ');

/** The open report queue and the restrictions in force (ADR 0098). */
export default async function ReportsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, unknown>>>;
}) {
  const { operator, allowed } = await requireOperator('reports.read');
  const nav = <OperatorNav name={operator.displayName} current="reports" />;
  if (!allowed)
    return (
      <>
        {nav}
        <NotPermitted />
      </>
    );
  const { notice, after } = await searchParams;
  const { commands } = adminRuntime();
  const [reports, restrictions] = commands
    ? await Promise.all([
        commands.client.listReports(operator.id, { limit: 50 }),
        commands.client.listRestrictions(operator.id, {
          limit: 50,
          ...(typeof after === 'string' ? { cursor: after } : {}),
        }),
      ])
    : [null, null];
  return (
    <>
      {nav}
      <div className="page-head">
        <div>
          <p className="eyebrow">Moderation</p>
          <h1>Reports</h1>
        </div>
      </div>
      {typeof notice === 'string' && notices[notice] ? (
        <p role="status" className="notice notice-ok">
          {notices[notice]}
        </p>
      ) : null}
      {reports?.kind === 'ok' ? (
        reports.value.items.length === 0 ? (
          <p>No open reports.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Filed</th>
                <th>Subject</th>
                <th>Reporter</th>
                <th>Reason</th>
                <th>Where</th>
                <th>On subject</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {reports.value.items.map((report) => (
                <tr key={report.id}>
                  <td>{when(report.createdAt)}</td>
                  <td>{report.subject ?? 'Closed account'}</td>
                  <td>{report.reporter ?? 'Closed account'}</td>
                  <td>{reportReasonLabels[report.reason]}</td>
                  <td>{report.surface}</td>
                  <td>{report.reportsOnSubject}</td>
                  <td>
                    <form action={resolveReportAction} className="inline-form">
                      <input type="hidden" name="reportId" value={report.id} />
                      <input
                        type="hidden"
                        name="subjectUserId"
                        value={report.subjectUserId}
                      />
                      <select name="outcome" defaultValue="dismissed">
                        <option value="dismissed">Dismiss</option>
                        <option value="warned">Warn</option>
                        <option value="suspended">Suspend</option>
                        <option value="banned">Ban</option>
                      </select>
                      <label>
                        Days
                        <input
                          type="number"
                          name="suspendDays"
                          min={1}
                          max={365}
                          defaultValue={7}
                        />
                      </label>
                      <button type="submit">Decide</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : (
        <p role="status" className="notice notice-warn">
          The report queue is unavailable.
        </p>
      )}
      <h2>In force</h2>
      {restrictions?.kind !== 'ok' ? (
        <p role="status" className="notice notice-warn">
          Restrictions are unavailable.
        </p>
      ) : restrictions.value.items.length > 0 ? (
        <>
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Kind</th>
                <th>From</th>
                <th>Until</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {restrictions.value.items.map((row) => (
                <tr key={row.id}>
                  <td>{row.username ?? 'Closed account'}</td>
                  <td>{row.kind}</td>
                  <td>{when(row.startsAt)}</td>
                  <td>{row.endsAt ? when(row.endsAt) : 'Indefinite'}</td>
                  <td>
                    <form action={liftRestrictionAction}>
                      <input type="hidden" name="actionId" value={row.id} />
                      <input type="hidden" name="userId" value={row.userId} />
                      <button type="submit">Lift</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {restrictions.value.nextCursor ? (
            <a href={`/reports?after=${restrictions.value.nextCursor}`}>
              Older
            </a>
          ) : null}
        </>
      ) : (
        <p>No restrictions in force.</p>
      )}
    </>
  );
}
