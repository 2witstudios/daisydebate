import { z } from 'zod';
import {
  activeRoomSchema,
  idSchema,
  roomRefusalSchema,
  roomViewSchema,
} from '@daisy/protocol';

/** Why POST /api/rooms refused, in words each form turns into its own line. */
export type RoomCreateRefusal =
  | 'settings'
  | 'forbidden'
  | 'rate-limited'
  | 'replayed'
  | 'ranked-unavailable'
  | 'actor-ineligible'
  | 'seat-unavailable'
  | 'ai-judge-premium'
  | 'notice-changed';
export type RoomCreateAnswer =
  | { readonly kind: 'created'; readonly roomId: string }
  /** The caller already holds a Room (ADR 0070): return them to it. */
  | { readonly kind: 'active-room'; readonly href: string | null }
  | { readonly kind: 'refused'; readonly reason: RoomCreateRefusal }
  | { readonly kind: 'unavailable' };

const refusalBodySchema = z.object({
  refusal: roomRefusalSchema,
  activeRoom: activeRoomSchema.nullable().optional(),
});
const conflictAnswer = (
  body: z.infer<typeof refusalBodySchema>,
): RoomCreateAnswer => {
  switch (body.refusal) {
    case 'active-room':
      return { kind: 'active-room', href: body.activeRoom?.href ?? null };
    case 'ranked-unavailable':
    case 'actor-ineligible':
    case 'seat-unavailable':
    case 'ai-judge-premium':
      return { kind: 'refused', reason: body.refusal };
    case 'command-conflict':
      return { kind: 'refused', reason: 'replayed' };
    // The format and the resolution disagree, or the catalog moved on. The
    // rest are a Room's later steps, which a create only meets as a bad request.
    case 'illegal-config':
    case 'format-unavailable':
    case 'version-conflict':
    case 'host-required':
    case 'room-closed':
    case 'not-seated':
    case 'incomplete-cast':
    case 'not-ready':
    case 'readiness-unavailable':
    case 'consent-conflict':
    case 'draw-unavailable':
    case 'bots-busy':
    case 'capture-premium':
    case 'broadcast-private':
    case 'content-waiver-required':
    case 'content-waiver-changed':
      return { kind: 'refused', reason: 'settings' };
    case 'capture-notice-changed':
      return { kind: 'refused', reason: 'notice-changed' };
  }
};
async function refusalOf(response: Response): Promise<RoomCreateAnswer> {
  if (response.status === 403) return { kind: 'refused', reason: 'forbidden' };
  if (response.status === 429)
    return { kind: 'refused', reason: 'rate-limited' };
  if (response.status !== 409) return { kind: 'refused', reason: 'settings' };
  const body = refusalBodySchema.safeParse(
    await response.json().catch(() => null),
  );
  return body.success
    ? conflictAnswer(body.data)
    : { kind: 'refused', reason: 'settings' };
}
const createdSchema = z.object({
  receipt: z.object({ roomId: idSchema }),
  view: roomViewSchema,
});

/** The one reading of POST /api/rooms's answer, for every form that creates a Room. */
export async function readRoomCreateAnswer(
  response: Response,
): Promise<RoomCreateAnswer> {
  // Inert Room routes answer 404: creation is unavailable, not refused.
  if (!response.ok)
    return response.status < 500 && response.status !== 404
      ? refusalOf(response)
      : { kind: 'unavailable' };
  const created = createdSchema.safeParse(
    await response.json().catch(() => null),
  );
  return created.success && created.data.receipt.roomId === created.data.view.id
    ? { kind: 'created', roomId: created.data.view.id }
    : { kind: 'unavailable' };
}
