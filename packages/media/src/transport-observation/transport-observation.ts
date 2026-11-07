import { create } from './create';
/** Native transport metadata only; never source completeness, silence, coverage or hearing. */
export type TransportObservation =
  | {
      readonly kind: 'unknown';
      readonly reason:
        | 'unavailable'
        | 'closed'
        | 'cancelled'
        | 'busy'
        | 'throttled'
        | 'clock'
        | 'deadline'
        | 'missing'
        | 'ambiguous'
        | 'malformed'
        | 'reset'
        | 'replaced'
        | 'unbound';
    }
  | {
      readonly kind: 'observed';
      readonly binding: {
        readonly incarnation: string;
        readonly trackId: string;
        readonly generation: number;
      };
      readonly startedAtMs: number;
      readonly endedAtMs: number;
      /** Whether this is a new counter baseline, not source continuity. */
      readonly baseline: boolean;
      readonly counters: {
        readonly packetsReceived: string;
        readonly packetsLost: string;
        readonly totalSamplesReceived: string;
        readonly concealedSamples: string;
      };
    };
export const TransportObservation = { create };
