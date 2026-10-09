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
