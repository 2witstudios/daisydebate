import {
  lobbyFormats,
  type FormatSlug,
  type RatingBand,
  type RoomListItem,
} from './room';

export const bandLabel = ({ min, max }: RatingBand): string => {
  if (min !== null && max !== null) return `${min}–${max}`;
  if (min !== null) return `${min}+`;
  if (max !== null) return `up to ${max}`;
  return 'any rating';
};

export const formatLabel = (slug: FormatSlug): string =>
  lobbyFormats.find((format) => format.slug === slug)?.label ?? slug;

export const modeLabel = (room: RoomListItem): string =>
  room.mode === 'ranked' ? 'Ranked' : 'Casual';

export const rulesLabel = (room: RoomListItem): string =>
  room.customRules ? 'Custom rules' : 'Standard rules';

/** "Waiting 2 min" for an open table, "14 watching" for a live room. */
export function statusLabel(room: RoomListItem, now: string): string {
  if (room.status === 'live') return `${room.watching} watching`;
  const minutes = Math.max(
    1,
    Math.floor((Date.parse(now) - Date.parse(room.waitingSince)) / 60_000),
  );
  return minutes < 60
    ? `Waiting ${minutes} min`
    : `Waiting ${Math.floor(minutes / 60)} h`;
}
