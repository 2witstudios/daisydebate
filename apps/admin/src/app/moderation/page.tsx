import Link from 'next/link';
import { moderationQueues, reportStatuses } from '@daisy/protocol/moderation';
import {
  moderationHref,
  moderationNoticeText,
  moderationQuery,
  queueLabels,
  statusLabels,
} from '../../features/moderation/view';
import { requireOperator } from '../../server/operator-gate';
import { adminRuntime } from '../../server/runtime';
import { NotPermitted, OperatorNav } from '../operator-nav';

export const dynamic = 'force-dynamic';
const pageSize = 25;

/** The operator queue: safety reports, and dispute and integrity review. */
export default async function ModerationPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, unknown>>>;
}) {
  const { operator, allowed } = await requireOperator('moderation.read');
  const nav = <OperatorNav name={operator.displayName} current="moderation" />;
  if (!allowed)
    return (
      <>
        {nav}
        <NotPermitted />
      </>
    );
  const query = moderationQuery(await searchParams);
  const { commands } = adminRuntime();
  if (!commands)
    return (
      <>
        {nav}
        <p role="status" className="notice">
          {moderationNoticeText('unconfigured')}
        </p>
      </>
    );
  const page = await commands.client.listReports(operator.id, {
    queue: query.queue,
    status: query.status,
    limit: pageSize,
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
  });
  return (
    <>
      {nav}
      <div className="page-head">
        <div>
          <p className="eyebrow">Reports</p>
          <h1>Moderation</h1>
        </div>
      </div>
      {query.notice ? (
        <p role="status" className="notice notice-ok">
          {moderationNoticeText(query.notice)}
        </p>
      ) : null}
      <nav aria-label="Queue" className="row-actions">
        {moderationQueues.map((queue) => (
          <Link
            key={queue}
            href={moderationHref({ queue, status: query.status })}
            aria-current={queue === query.queue ? 'page' : undefined}
          >
            {queueLabels[queue]}
          </Link>
        ))}
      </nav>
      <nav aria-label="Status" className="row-actions">
        {reportStatuses.map((status) => (
          <Link
            key={status}
            href={moderationHref({ queue: query.queue, status })}
            aria-current={status === query.status ? 'page' : undefined}
          >
            {statusLabels[status]}
          </Link>
        ))}
      </nav>
      {page.kind !== 'ok' ? (
        <p role="status" className="notice notice-warn">
          The participant app did not answer; the queue is not shown.
        </p>
      ) : page.value.items.length === 0 ? (
        <p>Nothing here.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Reported (UTC)</th>
                <th>Target</th>
                <th>Reason</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {page.value.items.map((report) => (
                <tr key={report.reportId}>
                  <td className="muted">{report.reportedAt}</td>
                  <th scope="row">
                    <Link href={`/moderation/${report.reportId}`}>
                      {report.targetKind}
                    </Link>
                  </th>
                  <td>{report.reason}</td>
                  <td>{statusLabels[report.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.kind === 'ok' && page.value.nextCursor ? (
        <Link
          href={moderationHref({
            queue: query.queue,
            status: query.status,
            cursor: page.value.nextCursor,
          })}
        >
          Next page
        </Link>
      ) : null}
    </>
  );
}
