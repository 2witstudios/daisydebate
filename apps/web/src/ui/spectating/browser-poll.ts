import {
  startPacedPoll,
  type PollAnswer,
} from '../../features/spectating/poll-pace';

const spread = () => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;

const schedule = (ms: number, run: () => void) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

/** A viewer's read loop on the browser's clock and entropy; returns its stop. */
export const startBrowserPoll = (read: () => Promise<PollAnswer>) =>
  startPacedPoll({ read, spread, schedule });
