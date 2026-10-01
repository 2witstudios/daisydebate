import type { RoomListItem } from '../../features/lobby/room';
import type { Viewer } from '../../features/lobby/filter';

/** The signed-in viewer's sample rating. */
export const sampleViewer: Viewer = { rating: 1400 };

const minutesBefore = (now: string, minutes: number): string =>
  new Date(Date.parse(now) - minutes * 60_000).toISOString();

/**
 * Sample rooms for the lobby: five open tables and three live debates.
 * Handles and ratings are samples. Waiting times hang off the injected `now`
 * so a table always reads as recently opened.
 */
export const sampleRooms = (now: string): readonly RoomListItem[] => [
  {
    id: 'room-tuesday-night',
    name: 'Tuesday night, no mercy',
    mode: 'ranked',
    customRules: false,
    host: { handle: 'host-one', rating: 1512 },
    status: 'open',
    band: { min: 1300, max: 1700 },
    waitingSince: minutesBefore(now, 2),
  },
  {
    id: 'room-newcomers',
    name: 'Newcomers welcome',
    mode: 'casual',
    customRules: true,
    host: { handle: 'host-two', rating: 1180 },
    status: 'open',
    band: { min: null, max: null },
    waitingSince: minutesBefore(now, 6),
  },
  {
    id: 'room-quarterfinal',
    name: 'Quarterfinal practice',
    mode: 'ranked',
    customRules: false,
    host: { handle: 'host-three', rating: 1390 },
    status: 'open',
    band: { min: 1200, max: 1400 },
    waitingSince: minutesBefore(now, 9),
  },
  {
    id: 'room-anything-goes',
    name: 'Anything goes',
    mode: 'casual',
    customRules: true,
    host: { handle: 'host-four', rating: 1455 },
    status: 'open',
    band: { min: null, max: null },
    waitingSince: minutesBefore(now, 1),
  },
  {
    id: 'room-top-of-ladder',
    name: 'Top of the ladder',
    mode: 'ranked',
    customRules: false,
    host: { handle: 'host-five', rating: 1710 },
    status: 'open',
    band: { min: 1600, max: 1800 },
    waitingSince: minutesBefore(now, 4),
  },
  {
    id: 'room-ranked-serious',
    name: 'Ranked, serious only',
    mode: 'ranked',
    customRules: false,
    host: { handle: 'debater-a', rating: 1620 },
    status: 'live',
    opponent: { handle: 'debater-b', rating: 1588 },
    watching: 14,
  },
  {
    id: 'room-finals-rehearsal',
    name: 'Finals rehearsal',
    mode: 'ranked',
    customRules: false,
    host: { handle: 'debater-c', rating: 1705 },
    status: 'live',
    opponent: { handle: 'debater-d', rating: 1690 },
    watching: 31,
  },
  {
    id: 'room-friendly-spar',
    name: 'Friendly spar',
    mode: 'casual',
    customRules: false,
    host: { handle: 'debater-e', rating: 1260 },
    status: 'live',
    opponent: { handle: 'debater-f', rating: 1240 },
    watching: 3,
  },
];
