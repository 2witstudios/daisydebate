import { requireOperator } from '../../../server/operator-gate';
import { adminRuntime } from '../../../server/runtime';
import { NotPermitted, OperatorNav } from '../../operator-nav';
import { contentModerationAction } from '../actions';
import { ProfilePhoto } from '../profile-photo';
import {
  contentModerationNoticeText,
  contentModerationQuery,
  profilePhotoSrc,
} from '../../../features/content-moderation/view';

export const dynamic = 'force-dynamic';

/** Photos shown at once: each carries its image, so the page stays light. */
const shownAtOnce = 20;

/**
 * Profile photos the automated check did not allow (ADR 0143). Only their
 * owners see them until an operator publishes or rejects each, oldest first.
 */
export default async function PhotoReviewsPage({
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
    ? await commands.client.listProfilePhotoReviews(operator.id)
    : null;
  if (!commands || read?.kind !== 'ok')
    return (
      <>
        {nav}
        <p role="status" className="notice notice-warn">
          {commands
            ? 'The photos in review could not be read.'
            : contentModerationNoticeText('unconfigured')}
        </p>
      </>
    );
  const shown = read.value.items.slice(0, shownAtOnce);
  const images = await Promise.all(
    shown.map(async (item) => {
      const photo = await commands.client.readProfilePhoto(
        operator.id,
        item.photoId,
      );
      return photo.kind === 'ok' ? profilePhotoSrc(photo.value) : null;
    }),
  );
  const waiting = read.value.items.length - shown.length;
  // The store lists at most 100, so a full list means there may be more.
  const atLeast = read.value.items.length >= 100 ? '+' : '';
  return (
    <>
      {nav}
      <div className="page-head">
        <div>
          <p className="eyebrow">Profiles</p>
          <h1>In-review photos</h1>
        </div>
      </div>
      {notice ? (
        <p role="status" className="notice notice-ok">
          {contentModerationNoticeText(notice)}
        </p>
      ) : null}
      {shown.length === 0 ? (
        <p>None.</p>
      ) : (
        <ul>
          {shown.map((item, index) => (
            <li key={item.photoId}>
              <p>{`${item.username}, uploaded ${item.uploadedAt}`}</p>
              <ProfilePhoto
                src={images[index] ?? null}
                username={item.username}
                live
              />
              <div className="row-actions">
                {(['approve', 'reject'] as const).map((outcome) => (
                  <form
                    key={outcome}
                    action={contentModerationAction}
                    className="row-actions"
                  >
                    <input
                      type="hidden"
                      name="commandId"
                      value={commands.ids.next()}
                    />
                    <input
                      type="hidden"
                      name="action"
                      value="profile_photo.review"
                    />
                    <input type="hidden" name="targetId" value={item.photoId} />
                    <input
                      type="hidden"
                      name="expectedVersion"
                      value={item.version}
                    />
                    <input type="hidden" name="outcome" value={outcome} />
                    <button type="submit">
                      {outcome === 'approve' ? 'Publish photo' : 'Reject photo'}
                    </button>
                  </form>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      {waiting > 0 ? (
        <p className="muted">
          {`${waiting}${atLeast} more waiting; decide these to see them.`}
        </p>
      ) : null}
    </>
  );
}
