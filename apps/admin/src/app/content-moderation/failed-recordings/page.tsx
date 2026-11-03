import { requireOperator } from '../../../server/operator-gate';
import { adminRuntime } from '../../../server/runtime';
import { NotPermitted, OperatorNav } from '../../operator-nav';
import { contentModerationAction } from '../actions';
import {
  contentModerationNoticeText,
  contentModerationQuery,
} from '../../../features/content-moderation/view';

export const dynamic = 'force-dynamic';

/**
 * Failed ranked Recordings, whose builds ran out of retries. They are kept forever,
 * so this is how an operator reaches one with no report on it.
 */
export default async function FailedRecordingsPage({
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
  const { notice } = contentModerationQuery(await searchParams);
  const { commands } = adminRuntime();
  const read = commands
    ? await commands.client.listRebuildableRecordings(operator.id)
    : null;
  if (!commands || read?.kind !== 'ok')
    return (
      <>
        {nav}
        <p role="status" className="notice notice-warn">
          {commands
            ? 'The failed recordings could not be read.'
            : contentModerationNoticeText('unconfigured')}
        </p>
      </>
    );
  return (
    <>
      {nav}
      <div className="page-head">
        <div>
          <p className="eyebrow">Recordings</p>
          <h1>Failed ranked recordings</h1>
        </div>
      </div>
      {notice ? (
        <p role="status" className="notice notice-ok">
          {contentModerationNoticeText(notice)}
        </p>
      ) : null}
      {read.value.items.length === 0 ? (
        <p>None.</p>
      ) : (
        <ul>
          {read.value.items.map((item) => (
            <li key={item.recordingId}>
              <p>
                {`Round ${item.roundId}: ${item.reason}, failed ${item.failedAt}`}
              </p>
              <form action={contentModerationAction} className="row-actions">
                <input
                  type="hidden"
                  name="commandId"
                  value={commands.ids.next()}
                />
                <input type="hidden" name="action" value="recording.rebuild" />
                <input type="hidden" name="targetId" value={item.recordingId} />
                <input
                  type="hidden"
                  name="expectedVersion"
                  value={item.version}
                />
                <button type="submit">Rebuild recording</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
