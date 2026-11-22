import {
  broadcastStopReasons,
  profileContentRemovalReasons,
  recordingLegalRemovalReasons,
  recordingTakedownReasons,
  type ContentModerationSubject,
} from '@daisy/protocol/content-moderation';
import { idSchema } from '@daisy/protocol/primitives';
import { isProfilePhotoTerminal } from '@daisy/protocol/public-profile';
import type { ReactNode } from 'react';
import {
  contentModerationNoticeText,
  contentModerationQuery,
  profilePhotoSrc,
  profileTextFieldLabels,
  statusLabels,
} from '../../../features/content-moderation/view';
import { requireOperator } from '../../../server/operator-gate';
import { adminRuntime } from '../../../server/runtime';
import { NotPermitted, OperatorNav } from '../../operator-nav';
import { contentModerationAction } from '../actions';
import { ProfilePhoto } from '../profile-photo';

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

/** A command on a versioned subject names the version this page read. */
function VersionedForm({
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
  photoSrc,
  nextId,
}: {
  readonly reportId: string;
  readonly subject: ContentModerationSubject;
  /** A reported photo's image, read with the page; null for anything else. */
  readonly photoSrc: string | null;
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
            <VersionedForm {...recordingForm} action="recording.restore">
              <button type="submit">Restore recording</button>
            </VersionedForm>
          ) : null}
          {subject.rebuildable ? (
            <VersionedForm {...recordingForm} action="recording.rebuild">
              <button type="submit">Rebuild recording</button>
            </VersionedForm>
          ) : null}
          {subject.status === 'taken_down' && subject.removable ? (
            <VersionedForm {...recordingForm} action="recording.remove">
              <button type="submit">Delete recording for good</button>
            </VersionedForm>
          ) : null}
          {subject.status !== 'taken_down' &&
          subject.status !== 'removing' &&
          subject.status !== 'removed' ? (
            <VersionedForm {...recordingForm} action="recording.takedown">
              <ReasonSelect reasons={recordingTakedownReasons} />
              <button type="submit">Take down recording</button>
            </VersionedForm>
          ) : null}
          {subject.status !== 'removing' && subject.status !== 'removed' ? (
            <VersionedForm {...recordingForm} action="recording.legal_remove">
              <ReasonSelect reasons={recordingLegalRemovalReasons} />
              <button type="submit">Remove for a legal reason</button>
            </VersionedForm>
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
    case 'profile_photo': {
      const photoForm = {
        ...form,
        targetId: subject.photoId,
        version: subject.version,
      };
      return (
        <>
          <p>
            Member {subject.username} · status {subject.status}
          </p>
          <ProfilePhoto
            src={photoSrc}
            username={subject.username}
            live={!isProfilePhotoTerminal(subject.status)}
          />
          {subject.status === 'in_review'
            ? (['approve', 'reject'] as const).map((outcome) => (
                <VersionedForm
                  key={outcome}
                  {...photoForm}
                  action="profile_photo.review"
                  commandId={nextId()}
                >
                  <input type="hidden" name="outcome" value={outcome} />
                  <button type="submit">
                    {outcome === 'approve' ? 'Publish photo' : 'Reject photo'}
                  </button>
                </VersionedForm>
              ))
            : null}
          {subject.status === 'published' ? (
            <VersionedForm
              {...photoForm}
              action="profile_photo.remove"
              commandId={nextId()}
            >
              <ReasonSelect reasons={profileContentRemovalReasons} />
              <button type="submit">Remove photo</button>
            </VersionedForm>
          ) : null}
        </>
      );
    }
    case 'profile_text':
      return (
        <>
          <p>
            {profileTextFieldLabels[subject.field]} of {subject.username}
          </p>
          <blockquote>{subject.text ?? 'Cleared.'}</blockquote>
          {subject.text !== null ? (
            <VersionedForm
              {...form}
              action="profile_text.remove"
              targetId={subject.profileId}
              commandId={nextId()}
              version={subject.version}
            >
              <input type="hidden" name="field" value={subject.field} />
              <ReasonSelect reasons={profileContentRemovalReasons} />
              <button type="submit">
                Clear {profileTextFieldLabels[subject.field].toLowerCase()}
              </button>
            </VersionedForm>
          ) : null}
        </>
      );
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
  const photo =
    subject?.kind === 'profile_photo' && !isProfilePhotoTerminal(subject.status)
      ? await commands.client.readProfilePhoto(operator.id, subject.photoId)
      : null;
  const photoSrc = photo?.kind === 'ok' ? profilePhotoSrc(photo.value) : null;
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
            photoSrc={photoSrc}
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
