import { isAppError } from '@daisy/errors';
import type { Clock } from '@daisy/clock';
import {
  createMessagingSocialSchemas,
  type MessagingSocialBounds,
} from '@daisy/protocol';
import type { ZodType } from 'zod';
import { parseValidated } from '../../server/http';
/** Shared command boundary for the actual social operations. */
export type SocialOperationDependencies<Store> = {
  readonly store: Store;
  readonly bounds: MessagingSocialBounds;
  readonly clock: Clock;
  readonly limit: (actorId: string) => Promise<void>;
};
export function parseSocialCommand<T>(
  bounds: MessagingSocialBounds,
  input: unknown,
  select: (
    schemas: ReturnType<typeof createMessagingSocialSchemas>,
  ) => ZodType<T>,
): T {
  return parseValidated(select(createMessagingSocialSchemas(bounds)), input);
}

/**
 * Spends the actor's limiter before the transaction (never while it holds
 * locks), but holds a refusal back: the caller throws it only after its
 * replay check, so a retry of an operation that already committed still
 * gets its stored result instead of RATE_LIMIT.
 */
export async function limitBeforeReplay(
  limit: (actorId: string) => Promise<void>,
  actorId: string,
): Promise<{ readonly unlessReplayed: () => void }> {
  try {
    await limit(actorId);
    return { unlessReplayed: () => {} };
  } catch (error) {
    if (!isAppError(error) || error.code !== 'RATE_LIMIT') throw error;
    return {
      unlessReplayed: () => {
        throw error;
      },
    };
  }
}
