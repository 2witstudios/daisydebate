import { browserScheduler } from './browser-time';

/** The media runtime's deadline (`at(ms, fire)`) on the browser's timer queue. */
export const mediaDeadlineAt = (ms: number, fire: () => void): (() => void) =>
  browserScheduler.after(fire, ms);
