import { z } from 'zod';
import {
  roomCatalogChoiceSchema,
  roomCastChoiceSchema,
  publishedResolutionSchema,
  type PublishedResolution,
  type RoomCatalogChoice,
  type RoomCastChoice,
} from '@daisy/protocol';

export type RoomTemplate = RoomCatalogChoice;
const catalogSchema = z.strictObject({
  choices: z.array(roomCatalogChoiceSchema),
  bots: z.array(roomCastChoiceSchema),
  resolutions: z.array(publishedResolutionSchema),
});
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export async function readRoomTemplates(fetch: FetchLike): Promise<
  | {
      readonly kind: 'found';
      readonly choices: readonly RoomTemplate[];
      readonly resolutions: readonly PublishedResolution[];
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
