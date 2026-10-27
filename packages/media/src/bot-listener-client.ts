import type { z } from 'zod';
import type { botActivityRelaySchema } from '@daisy/protocol/bot-activity';
import { acknowledgedReply, botListenerStateReply } from './worker-replies';
import {
  createSignedWorkerCall,
  type WorkerTransportDependencies,
} from './worker-transport';

type ActivityFrame = z.infer<typeof botActivityRelaySchema>['frames'][number];

/**
 * The bot listener's signed client (ISSUE-764): its own lease, its own read
 * and the activity relay, on the bot-listener routes only. It shares the
 * signed transport with capture, never capture's routes or authority.
 */
export function createBotListenerClient(input: WorkerTransportDependencies) {
  const { call, lease, calibratedRead } = createSignedWorkerCall(
    'bot-listener',
    input,
  );
  return {
    lease,
    /** State plus the calibration the listener times its frames with. */
    read: (epoch: number, signal?: AbortSignal) =>
      calibratedRead({ epoch }, botListenerStateReply, signal),
    /** Expendable heuristic relay; the server attaches the receipt and owns admission. */
    activity: async (
      batch: {
        readonly epoch: number;
        readonly segmentId: string;
        readonly roundParticipantId: string;
        readonly frames: readonly ActivityFrame[];
      },
      signal?: AbortSignal,
    ) => {
      await call(
        'activity',
        { ...batch, version: 1 },
        acknowledgedReply,
        signal,
      );
    },
  };
}
export type BotListenerClient = ReturnType<typeof createBotListenerClient>;
