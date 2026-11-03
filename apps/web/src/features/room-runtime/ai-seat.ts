import type { AiSeatAvailability } from '../../server/round-worker-policy';

/** A Room role as the AI seat that fills it: anything but a judge debates. */
export const aiSeatOf = (role: string): keyof AiSeatAvailability =>
  role === 'judge' ? 'judge' : 'debater';
