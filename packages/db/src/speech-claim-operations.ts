import { createAppError } from '@daisy/errors';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from './instrumented';

export function refuseUnscopedTranscriptMutation(): never {
  throw createAppError(
    'CONFLICT',
    'Signed transcript capture authority is required',
  );
}

/** Unscoped generated-text claims cannot mutate the capture transcript. */
export const speechClaimOperations = ({
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  async claimSpeech(_input: {
    readonly id: string;
    readonly roundId: string;
    readonly segmentId: string;
    readonly roundParticipantId: string;
    readonly token: string;
  }): Promise<
    | { readonly status: 'claimed'; readonly utteranceId: string }
    | { readonly status: 'held' | 'complete'; readonly utteranceId: string }
  > {
    return instrumented(eventSink, 'claimSpeech', async () =>
      refuseUnscopedTranscriptMutation(),
    );
  },
  async releaseSpeech(_input: {
    readonly utteranceId: string;
    readonly roundId: string;
    readonly token: string;
  }): Promise<void> {
    return instrumented(eventSink, 'releaseSpeech', async () =>
      refuseUnscopedTranscriptMutation(),
    );
  },
});
