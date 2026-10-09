import { z } from 'zod';
import {
  debateRoles,
  idSchema,
  roomConfigSchema,
  roundRulesSchema,
  roundStatusSchema,
} from '@daisy/protocol';
import type { RoundView } from '@daisy/protocol';

/** Validate only the persisted fields this consumer renders; CAP owns the full projection. */
const receiptSchema = z.object({
  id: idSchema,
  roomId: idSchema,
  status: roundStatusSchema,
  topic: z.string().min(1),
  config: roomConfigSchema,
  rules: roundRulesSchema,
  participants: z.array(
    z.object({
      id: idSchema,
      actorId: idSchema,
      kind: z.enum(['human', 'bot']),
      label: z.string(),
      role: z.enum(debateRoles),
      slot: z.int().min(0),
    }),
  ),
});

type RoundViewReceipt = Pick<
  RoundView,
  'id' | 'roomId' | 'status' | 'topic' | 'participants' | 'rules' | 'config'
>;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type Read =
  | { readonly kind: 'found'; readonly round: RoundViewReceipt }
  | { readonly kind: 'missing' | 'unavailable' };

export async function readRoundReceipt(
  fetch: FetchLike,
  id: string,
): Promise<Read> {
  if (!idSchema.safeParse(id).success) return { kind: 'missing' };
  try {
    const response = await fetch(`/api/rounds/${id}`, { method: 'GET' });
    if (response.status === 404) return { kind: 'missing' };
    if (!response.ok) return { kind: 'unavailable' };
    const parsed = receiptSchema.safeParse(await response.json());
    return parsed.success && parsed.data.id === id
      ? { kind: 'found', round: parsed.data }
      : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}
