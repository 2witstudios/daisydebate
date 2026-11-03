import type { RecordingMediaPanel } from '../../../features/recording/history';

type Gap = Extract<RecordingMediaPanel, { state: 'watch' }>['gaps'][number];

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
  control_lapse: 'Daisy lost contact with the debate, so this part was left out',
  private_phase: 'a private part of the debate',
  room_rotation: 'the room changed over',
};

export const gapCopy = (gap: Gap): string =>
  `${clockTime(gap.startMs)} to ${clockTime(gap.endMs)}: ${WHY[gap.reason]}`;
