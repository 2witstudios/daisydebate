import type { RecordingMediaPanel } from '../../../features/recording/history';

type Watchable = Extract<RecordingMediaPanel, { state: 'watch' }>;
type Gap = Watchable['gaps'][number];
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

const WHY: Readonly<Record<Gap['reason'], string>> = {
  capture_restart: 'recording stopped and restarted',
  not_public: 'between speeches, or not known to be public, so left out',
  private_phase: 'a private part of the debate',
  room_rotation: 'the room changed over',
};

export const gapCopy = (gap: Gap): string =>
  `${clockTime(gap.startMs)} to ${clockTime(gap.endMs)}: ${WHY[gap.reason]}`;

const UNRECORDED: Readonly<Record<Unrecorded['reason'], string>> = {
  late_start: 'recording started late',
  ended_early: 'recording ended early',
  broadcast_stopped: 'the broadcast was stopped',
};

export const unrecordedCopy = (part: Unrecorded): string =>
  `${part.part === 'start' ? 'The first' : 'The last'} ${clockTime(part.durationMs)} of the debate is not in this video: ${UNRECORDED[part.reason]}`;
