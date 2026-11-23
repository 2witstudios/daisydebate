import { Announcement } from '../../components/announcement/announcement';
import type { ContentReportTargetKind } from '@daisy/protocol/content-moderation';
import type { ShownPublicProfile } from '../../../features/profile/read-profile';
import {
  reportAnswerText,
  type ReportSubmission,
} from '../../../features/content-moderation/submit-report';
import { ReportForm } from '../../content-moderation/report-form';

type ReportTarget = {
  readonly targetKind: ContentReportTargetKind;
  readonly targetId: string;
  readonly label: string;
};

/**
 * What of a member's public profile someone else may report (ADR 0143): the
 * published photo, and the display name and bio while they are set. Nothing
 * shown is nothing to report.
 */
export function profileReportTargets(
  shown: ShownPublicProfile,
): readonly ReportTarget[] {
  const { profileId, photoId, displayName, bio } = shown;
  return [
    ...(photoId === null
      ? []
      : [
          {
            targetKind: 'profile_photo',
            targetId: photoId,
            label: 'Report photo',
          } as const,
        ]),
    ...(profileId === null || displayName === null
      ? []
      : [
          {
            targetKind: 'profile_display_name',
            targetId: profileId,
            label: 'Report display name',
          } as const,
        ]),
    ...(profileId === null || bio === null
      ? []
      : [
          {
            targetKind: 'profile_bio',
            targetId: profileId,
            label: 'Report bio',
          } as const,
        ]),
  ];
}

/**
 * A signed-in member's reports of someone else's photo, display name and bio,
 * each a native form under a closed disclosure, and the answer the page came
 * back with.
 */
export function ProfileReports({
  shown,
  notice,
  action,
}: {
  readonly shown: ShownPublicProfile;
  readonly notice: ReportSubmission | null;
  readonly action: (form: FormData) => void | Promise<void>;
}) {
  const targets = profileReportTargets(shown);
  if (targets.length === 0 && notice === null) return null;
  return (
    <div
      role="group"
      aria-label="Report this profile"
      className="flex flex-col gap-2"
    >
      {notice ? (
        <Announcement as="p" kind="progress" className="text-sm text-ink-muted">
          {reportAnswerText(notice)}
        </Announcement>
      ) : null}
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {targets.map((target) => (
          <ReportForm key={target.targetKind} {...target} action={action} />
        ))}
      </div>
    </div>
  );
}
