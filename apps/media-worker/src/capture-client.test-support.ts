import type { CaptureClient } from './capture-history';

/** A capture client answering history with `state` and recording each write in `calls`. */
export const recordingCaptureClient = (
  state: unknown,
  calls: string[],
  observed: unknown[] = [],
) =>
  ({
    read: async () => ({ state, calibration: {} }),
    append: async () => {
      calls.push('append');
      return {};
    },
    observe: async (observation: unknown) => {
      calls.push('observe');
      observed.push(observation);
      return {};
    },
  }) as unknown as CaptureClient;
