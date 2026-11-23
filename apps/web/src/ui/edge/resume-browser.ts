import { resumeOwnershipHeartbeatMs } from '../../features/rooms/resume-ownership';
import { browserScheduler } from './browser-time';

/** A resume claim's heartbeat on the browser's timer queue; returns its cancellation. */
export const resumeHeartbeat = (tick: () => void): (() => void) =>
  browserScheduler.every(tick, resumeOwnershipHeartbeatMs);
