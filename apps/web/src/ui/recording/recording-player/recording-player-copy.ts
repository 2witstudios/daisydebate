import type { RecordingMediaPanel } from '../../../features/recording/history';

type Watchable = Extract<RecordingMediaPanel, { state: 'watch' }>;
type LostGap = Watchable['lost'][number];
type PrivateGap = Watchable['keptPrivate'][number];
type Unrecorded = Watchable['unrecorded'][number];

export const RECORDING_SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;

/** Minutes and seconds, with hours once a video reaches them. */
export const clockTime = (ms: number): string => {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
};

const WHY: Readonly<Record<LostGap['reason'], string>> = {
  capture_restart: 'recording stopped and restarted',
  not_public: 'not known to be public, so left out',
  room_rotation: 'the room changed over',
};

const span = (gap: LostGap | PrivateGap) =>
  `${clockTime(gap.startMs)} to ${clockTime(gap.endMs)}`;

export const gapCopy = (gap: LostGap): string =>
  `${span(gap)}: ${WHY[gap.reason]}`;

export const privateCopy = (gaps: readonly PrivateGap[]): string =>
  `Kept private by design, so not shown: ${gaps.map(span).join(', ')}`;

const UNRECORDED: Readonly<Record<Unrecorded['reason'], string>> = {
  late_start: 'recording started late',
  ended_early: 'recording ended early',
  broadcast_stopped: 'the broadcast was stopped',
};

export const unrecordedCopy = (part: Unrecorded): string =>
  `${part.part === 'start' ? 'The first' : 'The last'} ${clockTime(part.durationMs)} of the debate is not in this video: ${UNRECORDED[part.reason]}`;
