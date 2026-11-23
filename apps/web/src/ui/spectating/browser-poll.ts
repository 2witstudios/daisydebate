import type { BrowserScheduler } from '../edge/browser-time';
import {
  startPacedPoll,
  type PollAnswer,
} from '../../features/spectating/poll-pace';

const spread = () => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;

/** A viewer's read loop on the given clock and the browser's entropy; returns its stop. */
export const startBrowserPoll = (
  read: () => Promise<PollAnswer>,
  after: BrowserScheduler['after'],
) => startPacedPoll({ read, spread, schedule: (ms, run) => after(run, ms) });
