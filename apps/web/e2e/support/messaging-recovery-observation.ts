import type { Page, WebSocket } from '@playwright/test';
import { clientMessageSchema } from '@daisy/protocol';
import { systemClock } from '@daisy/clock';
import { expect } from './fixtures';
import { STEP_LIMIT_MS } from './bounded-step';
import { serverFrame } from './subscription-ledger';
import {
  initialRecoveryObservation,
  recoveryObservation,
  recoveryObservationView,
} from './messaging-recovery-observation-state';

/** Attach to a fresh target before its first navigation; prior pages cannot qualify. */
export function watchRecoveredChannel(page: Page, channelId: string) {
  if (page.url() !== 'about:blank')
    throw new Error('Recovery observation requires a fresh target page');
  type State = ReturnType<typeof initialRecoveryObservation>;
  const states = new Map<WebSocket, State>();
  let current: WebSocket | null = null;
  let sockets = 0,
    observes = 0,
    readyFrames = 0;
  const now = () => Date.parse(systemClock.now());
  const view = () =>
    recoveryObservationView(
      current === null ? initialRecoveryObservation() : states.get(current)!,
      now(),
    );
  const opened = (socket: WebSocket) => {
    if (new URL(socket.url()).pathname !== '/ws') return;
    current = socket;
    sockets += 1;
    states.set(socket, initialRecoveryObservation());
    socket.on('framesent', ({ payload }) => {
      let value: unknown;
      try {
        value = JSON.parse(String(payload));
      } catch {
        return;
      }
      const parsed = clientMessageSchema.safeParse(value);
      if (!parsed.success) return;
      const frame = parsed.data;
      const before = states.get(socket)!;
      const next = recoveryObservation(
        before,
        { kind: 'sent', frame },
        channelId,
        now(),
      );
      states.set(socket, next);
      if (next !== before && frame.type === 'observe') observes += 1;
    });
    socket.on('framereceived', ({ payload }) => {
      const frame = serverFrame(payload);
      if (frame === null) return;
      const before = states.get(socket)!;
      const next = recoveryObservation(
        before,
        { kind: 'received', frame },
        channelId,
        now(),
      );
      states.set(socket, next);
      if (next !== before && frame.type === 'observation.ready')
        readyFrames += 1;
    });
    socket.on('close', () => {
      states.set(
        socket,
        recoveryObservation(
          states.get(socket)!,
          { kind: 'closed' },
          channelId,
          now(),
        ),
      );
      if (current === socket) current = null;
    });
  };
  page.on('websocket', opened);
  return {
    snapshot: () => ({ ...view(), sockets, observes, readyFrames }),
    ready: async () => {
      await expect
        .poll(
          () => {
            const sample = view();
            return sample.ready && sample.revision !== null;
          },
          { timeout: STEP_LIMIT_MS },
        )
        .toBe(true);
      const sample = view();
      expect(sample.ready).toBe(true);
      expect(sample.revision).not.toBeNull();
      return sample.revision!;
    },
    heard: (revision: number) =>
      expect
        .poll(() => view().revision ?? -1, { timeout: STEP_LIMIT_MS })
        .toBeGreaterThanOrEqual(revision),
  };
}
