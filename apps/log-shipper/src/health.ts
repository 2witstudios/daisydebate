import { clickHouseTime } from './rows';

/** The NATS connection states a heartbeat reports. */
type NatsState = 'connected' | 'disconnected' | 'closed';
export type HeartbeatRow = {
  readonly at: string;
  readonly nats_state: NatsState;
  readonly reconnects: number;
  readonly buffered: number;
  readonly pending_tallies: number;
};

/**
 * The shipper's coverage signal (ADR 0084): NATS core delivery is
 * at-most-once, so a disconnect is a gap in what the store saw. The state
 * follows the client's status events; each reconnect is counted.
 */
export function createNatsHealth() {
  let state: NatsState = 'connected';
  let reconnects = 0;
  return {
    observe(status: { readonly type: string }) {
      if (status.type === 'disconnect') state = 'disconnected';
      else if (status.type === 'reconnect') {
        state = 'connected';
        reconnects += 1;
      } else if (status.type === 'close') state = 'closed';
    },
    heartbeat(
      now: string,
      buffer: {
        readonly size: () => number;
        readonly pendingTallies: () => number;
      },
    ): HeartbeatRow {
      return {
        at: clickHouseTime(now).slice(0, 19),
        nats_state: state,
        reconnects,
        buffered: buffer.size(),
        pending_tallies: buffer.pendingTallies(),
      };
    },
  };
}
