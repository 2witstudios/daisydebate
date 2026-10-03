import type { RatingBand, RoomListItem } from './room';

export const bandLabel = ({ min, max }: RatingBand): string => {
  if (min !== null && max !== null) return `${min}–${max}`;
  if (min !== null) return `${min}+`;
  if (max !== null) return `up to ${max}`;
  return 'any rating';
};

export const modeLabel = (room: RoomListItem): string =>
  room.mode === 'ranked' ? 'Ranked' : 'Casual';

export const rulesLabel = (room: RoomListItem): string =>
  room.customRules ? 'Custom rules' : 'Standard rules';

const judgeLabels = {
  ai: 'AI judge',
  assigned: 'Judge assigned by Daisy',
} as const;

/** Who judges; an open room with a person judge still needs one to join. */
export function judgeLabel(room: RoomListItem): string {
  if (room.judge !== 'person') return judgeLabels[room.judge];
  return room.status === 'open' ? 'Needs a judge' : 'Person judging';
}

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
