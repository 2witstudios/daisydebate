import { participantAccess } from '@daisy/auth/authorization';
import type { Database } from '@daisy/db';
import {
  decideInvitationEnd,
  decideRoomInvitation,
} from '@daisy/debate-engine';
import type { RoomSeatKind } from '@daisy/protocol';

type Store = Pick<Database, 'inviteToRoom' | 'endRoomInvitation'>;
type Caller = { readonly userId: string; readonly actorId: string };

/** Invitations a host may send per hour (ADR 0124). */
export const roomInvitationLimit = {
  rule: { windowSeconds: 3_600, max: 60 },
} as const;

/**
 * A host invites one member by username to a seat kind (ADR 0124). The
 * store locks the Room and both accounts; the engine's rule decides over
 * what it read, with ADR 0075's admission rule for the invitee.
 */
export const inviteToRoom = (
  deps: { readonly store: Store; readonly nextId: () => string },
  caller: Caller,
  input: {
    readonly roomId: string;
    readonly username: string;
    readonly seat: RoomSeatKind;
  },
) =>
  deps.store.inviteToRoom({
    caller,
    roomId: input.roomId,
    username: input.username,
    seat: input.seat,
    ids: {
      invitation: deps.nextId(),
      notification: deps.nextId(),
      emailJob: deps.nextId(),
    },
    admitted: (account) => participantAccess(account),
    decide: (facts) =>
      decideRoomInvitation({
        ...facts,
        callerActorId: caller.actorId,
        seat: input.seat,
      }),
  });

/** The invitee declines, or the host withdraws. */
export const endRoomInvitation = (
  deps: { readonly store: Store },
  caller: Caller,
  input: {
    readonly invitationId: string;
    readonly end: 'decline' | 'withdraw';
  },
) =>
  deps.store.endRoomInvitation({
    caller,
    invitationId: input.invitationId,
    end: input.end,
    decide: (facts) =>
      decideInvitationEnd({
        ...facts,
        callerActorId: caller.actorId,
        end: input.end,
      }),
  });
