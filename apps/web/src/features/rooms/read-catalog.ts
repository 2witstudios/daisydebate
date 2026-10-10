import { z } from 'zod';
import {
  roomCatalogChoiceSchema,
  roomCastChoiceSchema,
  type RoomCatalogChoice,
  type RoomCastChoice,
} from '@daisy/protocol';

export type RoomTemplate = RoomCatalogChoice;
const catalogSchema = z.strictObject({
  choices: z.array(roomCatalogChoiceSchema),
  bots: z.array(roomCastChoiceSchema),
});
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export async function readRoomTemplates(fetch: FetchLike): Promise<
  | {
      readonly kind: 'found';
      readonly choices: readonly RoomTemplate[];
      readonly bots: readonly RoomCastChoice[];
    }
  | { readonly kind: 'unavailable' }
> {
  try {
    const response = await fetch('/api/rooms/catalog', { method: 'GET' });
    if (!response.ok) return { kind: 'unavailable' };
    const parsed = catalogSchema.safeParse(await response.json());
    return parsed.success
      ? { kind: 'found', ...parsed.data }
      : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}
