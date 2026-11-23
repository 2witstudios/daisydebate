import { browserScheduler } from './browser-time';
import {
  startPacedPoll,
  type PollAnswer,
} from '../../features/spectating/poll-pace';

const spread = () => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;

const schedule = (ms: number, run: () => void) =>
  browserScheduler.after(run, ms);

/** A viewer's read loop on the browser's clock and entropy; returns its stop. */
export const startBrowserPoll = (read: () => Promise<PollAnswer>) =>
  startPacedPoll({ read, spread, schedule });
