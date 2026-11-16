import {
  profilePhotoMimes,
  type OwnPublicProfileView,
} from '@daisy/protocol/public-profile';
import { Avatar } from '../../components/avatar/avatar';
import { Badge } from '../../components/badge/badge';
import { Button } from '../../components/button/button';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';
import { profilePhotoSrc } from '../../profile/photo-src';

/** What the control is doing: nothing, or one request at a time. */
export type PhotoControlActivity = 'idle' | 'uploading' | 'removing';

export type ProfilePhotoControlProps = {
  /** Whose photo, for the initials when there is none. */
  readonly name: string;
  readonly photo: OwnPublicProfileView['photo'];
  readonly photoUploads: OwnPublicProfileView['photoUploads'];
  readonly activity: PhotoControlActivity;
  /** What the last upload or removal came to, once there was one. */
  readonly notice: string | null;
  readonly onChoose: (file: File) => void;
  readonly onRemove: () => void;
};

/**
 * The member's photo: the published one everyone sees, and a newer one only
 * they see while it is reviewed. No form: a file goes up only through the
 * script's own request, so nothing is posted before hydration.
 */
export function renderProfilePhotoControl({
  name,
  photo,
  photoUploads,
  activity,
  notice,
  onChoose,
  onRemove,
}: ProfilePhotoControlProps) {
  const busy = activity !== 'idle';
  const hasPhoto = photo.published !== null || photo.inReview !== null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex items-center gap-2">
          <Avatar
            name={name}
            src={profilePhotoSrc(photo.published, 128)}
            size="lg"
          />
          <span className="text-sm text-ink-muted">
            {photo.published === null ? 'No photo' : 'Your photo'}
          </span>
        </span>
        {photo.inReview === null ? null : (
          <span className="flex items-center gap-2">
            <Avatar
              name={name}
              src={profilePhotoSrc(photo.inReview, 128)}
              size="lg"
            />
            <Badge tone="gold">In review</Badge>
            <span className="text-sm text-ink-muted">
              Only you see it until it is reviewed.
            </span>
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {photoUploads === 'available' ? (
          <label
            className={cn(
              buttonClass('secondary'),
              'cursor-pointer has-disabled:cursor-not-allowed has-disabled:opacity-60',
            )}
          >
            {activity === 'uploading' ? 'Uploading…' : 'Upload photo'}
            <input
              type="file"
              accept={profilePhotoMimes.join(',')}
              disabled={busy}
              className="sr-only"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) onChoose(file);
              }}
            />
          </label>
        ) : (
          <p className="text-sm text-ink-muted">
            Photo uploads are unavailable right now.
          </p>
        )}
        {hasPhoto ? (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={onRemove}
          >
            {activity === 'removing' ? 'Removing…' : 'Remove photo'}
          </Button>
        ) : null}
      </div>
      {notice ? (
        <p role="status" className="text-sm text-ink-muted">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
