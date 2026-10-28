import { socialMemberReading } from '@daisy/auth/social-reading';
import { betaDmPolicy } from '@daisy/auth/social-policy';
import type { RealtimeReadingPolicy } from './authorization';

/**
 * The reading policy production realtime composes: the same DEC-251 member
 * reading web's messaging commands evaluate. Without it every channel
 * subscription is refused, because authorization requires reading evidence.
 */
export const realtimeReadingPolicy: RealtimeReadingPolicy =
  socialMemberReading(betaDmPolicy);
