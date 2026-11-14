import { andMore } from './at-scale';
import { sampleAction } from './action';
import type { AttentionRoom } from './tab-round';

/** One reminder for overdue ballots; individual cases keep their own action. */
export function mergeRoomNeeds(
  rooms: readonly AttentionRoom[],
): readonly AttentionRoom[] {
  const overdue = rooms.filter((room) => room.need === 'overdue_ballot');
  const withdrawn = rooms.filter((room) => room.need === 'withdrawn_judge');
  if (overdue.length < 2 && withdrawn.length < 2) return rooms;
  const reminders =
    overdue.length < 2
      ? []
      : [
          {
            title: `${overdue.length} ballots are overdue`,
            detail: andMore(overdue.map((room) => room.title)),
            words: overdue.flatMap((room) => [room.title, room.detail]),
            action: sampleAction(`Remind all ${overdue.length}`, true),
          },
        ];
  const replacements =
    withdrawn.length < 2
      ? []
      : [
          {
            title: `${withdrawn.length} judges withdrew`,
            detail: withdrawn.map((room) => room.title).join(' · '),
            action: sampleAction(`Review ${withdrawn.length} rooms`, true),
          },
        ];
  return [
    ...rooms.filter(
      (room) =>
        !(overdue.length > 1 && overdue.includes(room)) &&
        !(withdrawn.length > 1 && withdrawn.includes(room)),
    ),
    ...replacements,
    ...reminders,
  ];
}
