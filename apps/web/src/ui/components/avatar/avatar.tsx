import { PresenceDot } from '../presence-dot/presence-dot';
import type { PresenceStatus as Presence } from '@daisy/protocol';
import { avatarClass, type AvatarSize } from './avatar-class';
import { initialsOf } from './initials';

export type AvatarProps = {
  readonly name: string;
  readonly src?: string | undefined;
  readonly presence?: Presence;
  readonly size?: AvatarSize;
  /**
   * Set when the caller already renders `name` as visible text next to the
   * avatar (unconditionally, not just hidden at some viewport), so the
   * avatar's own accessible name would announce it a second time.
   */
  readonly nameVisible?: boolean;
};

const pixelsBySize: Readonly<Record<AvatarSize, number>> = {
  sm: 28,
  md: 36,
  lg: 44,
};

export function Avatar({
  name,
  src,
  presence,
  size = 'md',
  nameVisible = false,
}: AvatarProps) {
  const pixels = pixelsBySize[size];
  return (
    <span className={avatarClass(size)}>
      {src ? (
        <img
          src={src}
          alt=""
          width={pixels}
          height={pixels}
          className="size-full rounded-full object-cover"
        />
      ) : (
        <span className="tracking-wide" aria-hidden="true">
          {initialsOf(name)}
        </span>
      )}
      {presence ? (
        <span className="absolute -right-avatar-presence -bottom-avatar-presence inline-flex">
          <PresenceDot presence={presence} />
        </span>
      ) : null}
      {nameVisible ? null : <span className="sr-only">{name}</span>}
    </span>
  );
}
