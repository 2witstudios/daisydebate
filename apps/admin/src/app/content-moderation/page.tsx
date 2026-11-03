import Link from 'next/link';
import {
  contentModerationQueues,
  contentReportStatuses,
} from '@daisy/protocol/content-moderation';
import {
  contentModerationHref,
  contentModerationNoticeText,
  contentModerationQuery,
  queueLabels,
  statusLabels,
} from '../../features/content-moderation/view';
import { requireOperator } from '../../server/operator-gate';
import { adminRuntime } from '../../server/runtime';
import { NotPermitted, OperatorNav } from '../operator-nav';

export const dynamic = 'force-dynamic';
const pageSize = 25;

/** The operator queue: safety reports, and dispute and integrity review. */
export default async function ContentModerationPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, unknown>>>;
}) {
  const { operator, allowed } = await requireOperator(
    'content_moderation.read',
  );
  const nav = (
    <OperatorNav name={operator.displayName} current="content-moderation" />
  );
  if (!allowed)
    return (
      <>
        {nav}
        <NotPermitted />
      </>
    );
  const query = contentModerationQuery(await searchParams);
  const { commands } = adminRuntime();
  if (!commands)
    return (
      <>
        {nav}
        <p role="status" className="notice">
          {contentModerationNoticeText('unconfigured')}
        </p>
      </>
    );
  const page = await commands.client.listContentReports(operator.id, {
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
      <p>
        <Link href="/content-moderation/failed-recordings">
          Failed ranked recordings
        </Link>
      </p>
      {query.notice ? (
        <p role="status" className="notice notice-ok">
          {contentModerationNoticeText(query.notice)}
        </p>
      ) : null}
      <nav aria-label="Queue" className="row-actions">
        {contentModerationQueues.map((queue) => (
          <Link
            key={queue}
            href={contentModerationHref({ queue, status: query.status })}
            aria-current={queue === query.queue ? 'page' : undefined}
          >
            {queueLabels[queue]}
          </Link>
        ))}
      </nav>
      <nav aria-label="Status" className="row-actions">
        {contentReportStatuses.map((status) => (
          <Link
            key={status}
            href={contentModerationHref({ queue: query.queue, status })}
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
                    <Link href={`/content-moderation/${report.reportId}`}>
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
          href={contentModerationHref({
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
