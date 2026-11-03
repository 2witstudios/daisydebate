import {
  broadcastStopReasons,
  recordingLegalRemovalReasons,
  recordingTakedownReasons,
  type ContentModerationSubject,
} from '@daisy/protocol/content-moderation';
import { idSchema } from '@daisy/protocol';
import type { ReactNode } from 'react';
import {
  contentModerationNoticeText,
  contentModerationQuery,
  statusLabels,
} from '../../../features/content-moderation/view';
import { requireOperator } from '../../../server/operator-gate';
import { adminRuntime } from '../../../server/runtime';
import { NotPermitted, OperatorNav } from '../../operator-nav';
import { contentModerationAction } from '../actions';

export const dynamic = 'force-dynamic';

const slowModeChoices = [0, 10, 30, 60, 300];

/** One action as a plain POST, carrying a command id minted with the page. */
function ActionForm({
  reportId,
  action,
  targetId,
  commandId,
  children,
}: {
  readonly reportId: string;
  readonly action: string;
  readonly targetId: string;
  readonly commandId: string;
  readonly children: ReactNode;
}) {
  return (
    <form action={contentModerationAction} className="row-actions">
      <input type="hidden" name="reportId" value={reportId} />
      <input type="hidden" name="commandId" value={commandId} />
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="targetId" value={targetId} />
      {children}
    </form>
  );
}

/** A command on a Recording names the version this page read. */
function RecordingForm({
  version,
  children,
  ...form
}: Parameters<typeof ActionForm>[0] & { readonly version: number }) {
  return (
    <ActionForm {...form}>
      <input type="hidden" name="expectedVersion" value={version} />
      {children}
    </ActionForm>
  );
}

function ReasonSelect({ reasons }: { readonly reasons: readonly string[] }) {
  return (
    <label>
      Reason{' '}
      <select name="reason" required>
        {reasons.map((reason) => (
          <option key={reason} value={reason}>
            {reason}
          </option>
        ))}
      </select>
    </label>
  );
}

/** What this subject can have done to it, and nothing else. */
function SubjectActions({
  reportId,
  subject,
  nextId,
}: {
  readonly reportId: string;
  readonly subject: ContentModerationSubject;
  readonly nextId: () => string;
}) {
  const form = { reportId };
  switch (subject.kind) {
    case 'round':
      return (
        <>
          <dl>
            <dt>Resolution</dt>
            <dd>{subject.resolution}</dd>
            <dt>Competition</dt>
            <dd>{subject.competitionType}</dd>
          </dl>
          {subject.broadcastId && !subject.broadcastStopped ? (
            <ActionForm
              {...form}
              action="broadcast.stop"
              targetId={subject.broadcastId}
              commandId={nextId()}
            >
              <ReasonSelect reasons={broadcastStopReasons} />
              <button type="submit">Stop broadcast</button>
            </ActionForm>
          ) : null}
          {subject.broadcastId ? (
            <ActionForm
              {...form}
              action="broadcast.chat_slow_mode.update"
              targetId={subject.broadcastId}
              commandId={nextId()}
            >
              <label>
                Slow mode, seconds{' '}
                <select
                  name="seconds"
                  defaultValue={subject.chatSlowModeSeconds}
                >
                  {slowModeChoices.map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds === 0 ? 'Off' : seconds}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit">Set slow mode</button>
            </ActionForm>
          ) : null}
        </>
      );
    case 'recording': {
      const recordingForm = {
        ...form,
        targetId: subject.recordingId,
        commandId: nextId(),
        version: subject.version,
      };
      return (
        <>
          <p>Status: {subject.status}</p>
          {subject.takedownReason ? (
            <p>Taken down for: {subject.takedownReason}</p>
          ) : null}
          {subject.status === 'taken_down' && !subject.removable ? (
            <p>
              Held as evidence while a report on it or its Round is open. Close
              the report to delete it. Only a legal removal can delete it
              sooner.
            </p>
          ) : null}
          {subject.restorable ? (
            <RecordingForm {...recordingForm} action="recording.restore">
              <button type="submit">Restore recording</button>
            </RecordingForm>
          ) : null}
          {subject.rebuildable ? (
            <RecordingForm {...recordingForm} action="recording.rebuild">
              <button type="submit">Rebuild recording</button>
            </RecordingForm>
          ) : null}
          {subject.status === 'taken_down' && subject.removable ? (
            <RecordingForm {...recordingForm} action="recording.remove">
              <button type="submit">Delete recording for good</button>
            </RecordingForm>
          ) : null}
          {subject.status !== 'taken_down' &&
          subject.status !== 'removing' &&
          subject.status !== 'removed' ? (
            <RecordingForm {...recordingForm} action="recording.takedown">
              <ReasonSelect reasons={recordingTakedownReasons} />
              <button type="submit">Take down recording</button>
            </RecordingForm>
          ) : null}
          {subject.status !== 'removing' && subject.status !== 'removed' ? (
            <RecordingForm {...recordingForm} action="recording.legal_remove">
              <ReasonSelect reasons={recordingLegalRemovalReasons} />
              <button type="submit">Remove for a legal reason</button>
            </RecordingForm>
          ) : null}
        </>
      );
    }
    case 'chat_message':
      return (
        <>
          <blockquote>{subject.text ?? 'Removed.'}</blockquote>
          {subject.text !== null ? (
            <ActionForm
              {...form}
              action="chat_message.remove"
              targetId={subject.messageId}
              commandId={nextId()}
            >
              <button type="submit">Remove message</button>
            </ActionForm>
          ) : null}
          {subject.authorUserId ? (
            <ActionForm
              {...form}
              action="account.audience_ban.update"
              targetId={subject.authorUserId}
              commandId={nextId()}
            >
              <input type="hidden" name="state" value="banned" />
              <button type="submit">Ban from audience interaction</button>
            </ActionForm>
          ) : null}
        </>
      );
    case 'ballot_feedback':
      return <blockquote>{subject.text ?? 'No feedback text.'}</blockquote>;
  }
}

/** One report: what was reported, what can be done, and how to resolve it. */
export default async function ContentReportPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly reportId: string }>;
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
  const reportId = idSchema.safeParse((await params).reportId);
  const { commands } = adminRuntime();
  const read =
    reportId.success && commands
      ? await commands.client.readContentReport(operator.id, reportId.data)
      : null;
  if (!commands || read?.kind !== 'ok' || !reportId.success)
    return (
      <>
        {nav}
        <p role="status" className="notice notice-warn">
          {commands
            ? 'This report could not be read.'
            : contentModerationNoticeText('unconfigured')}
        </p>
      </>
    );
  const { report, subject } = read.value;
  const nextId = () => commands.ids.next();
  return (
    <>
      {nav}
      <div className="page-head">
        <div>
          <p className="eyebrow">{report.targetKind}</p>
          <h1>{report.reason}</h1>
        </div>
      </div>
      {notice ? (
        <p role="status" className="notice notice-ok">
          {contentModerationNoticeText(notice)}
        </p>
      ) : null}
      <p className="muted">
        {statusLabels[report.status]} · reported {report.reportedAt}
      </p>
      {subject ? (
        <section className="section">
          <SubjectActions
            reportId={report.reportId}
            subject={subject}
            nextId={nextId}
          />
        </section>
      ) : (
        <p>What was reported is no longer there.</p>
      )}
      {report.status === 'open' ? (
        <section className="section row-actions">
          {(['upheld', 'dismissed'] as const).map((outcome) => (
            <ActionForm
              key={outcome}
              reportId={report.reportId}
              action="content_report.resolve"
              targetId={report.reportId}
              commandId={nextId()}
            >
              <input type="hidden" name="outcome" value={outcome} />
              <button type="submit">
                {outcome === 'upheld' ? 'Uphold' : 'Dismiss'}
              </button>
            </ActionForm>
          ))}
        </section>
      ) : null}
    </>
  );
}
