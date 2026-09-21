import { PresenceDot } from '../presence-dot/presence-dot';
import type { Presence } from '../../types/presence/presence';
import { avatarClass, type AvatarSize } from './avatar-class';

export type AvatarProps = {
  readonly name: string;
  readonly src?: string | undefined;
  readonly presence?: Presence;
  readonly size?: AvatarSize;
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

export function Avatar({ name, src, presence, size = 'md' }: AvatarProps) {
  return (
    <span className={avatarClass(size)}>
      {src ? (
        <img src={src} alt="" className="size-full rounded-full object-cover" />
      ) : (
        <span className="tracking-wide" aria-hidden="true">
          {initials(name)}
        </span>
      )}
      {presence ? (
        <span className="absolute -right-avatar-presence -bottom-avatar-presence inline-flex">
          <PresenceDot presence={presence} />
        </span>
      ) : null}
      <span className="sr-only">{name}</span>
    </span>
  );
}
