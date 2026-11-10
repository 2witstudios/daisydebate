import {
  idSchema,
  roomInvitationCommandSchemas,
  roomInvitationRefusals,
  type RoomSeatKind,
} from '@daisy/protocol';
import { parseValidated, readJson, refusalResponse } from '../../server/http';
import {
  runMemberRoute,
  type BudgetedMemberBoundary,
  type MemberCaller,
} from '../../server/member-boundary';
import { roomInvitationLimit } from './operations';

const MAX_BODY_BYTES = 512;
const endRate = { windowSeconds: 60, max: 30 } as const;

/**
 * The Room invitation routes (ADR 0124): same-origin, admitted members, a
 * bounded body, the host's own budget. Refusals answer with their closed
 * reason; anything else stays private.
 */
export function createRoomInvitationHandlers(deps: {
  readonly boundary: BudgetedMemberBoundary;
  readonly invite: (
    caller: MemberCaller,
    input: {
      readonly roomId: string;
      readonly username: string;
      readonly seat: RoomSeatKind;
    },
  ) => Promise<{ readonly invitationId: string }>;
  readonly end: (
    caller: MemberCaller,
    input: {
      readonly invitationId: string;
      readonly end: 'decline' | 'withdraw';
    },
  ) => Promise<{ readonly roomId: string }>;
}) {
  const answer = async (
    requestId: string,
    work: () => Promise<Record<string, unknown>>,
  ) => {
    try {
      return Response.json({ version: 1, ...(await work()) });
    } catch (error) {
      const refused = refusalResponse(error, requestId, roomInvitationRefusals);
      if (refused) return refused;
      throw error;
    }
  };
  return {
    /** POST /api/rooms/{roomId}/invitations */
    invite: (request: Request, rawRoomId: string) =>
      runMemberRoute(
        deps.boundary,
        request,
        {
          name: 'rooms.invitations.invite',
          readOnly: false,
          bucket: 'room-invitations',
          rule: roomInvitationLimit.rule,
          beforeBudget: () => parseValidated(idSchema, rawRoomId),
        },
        async (caller, { requestId }) => {
          const { username, seat } = parseValidated(
            roomInvitationCommandSchemas.invite,
            await readJson(request, MAX_BODY_BYTES),
          );
          return answer(requestId, () =>
            deps.invite(caller, { roomId: rawRoomId, username, seat }),
          );
        },
      ),
    /** POST /api/room-invitations/{decline|withdraw} */
    end: (request: Request, end: 'decline' | 'withdraw') =>
      runMemberRoute(
        deps.boundary,
        request,
        {
          name: `rooms.invitations.${end}`,
          readOnly: false,
          bucket: 'room-invitation-ends',
          rule: endRate,
        },
        async (caller, { requestId }) => {
          const { invitationId } = parseValidated(
            roomInvitationCommandSchemas[end],
            await readJson(request, MAX_BODY_BYTES),
          );
          return answer(requestId, () =>
            deps.end(caller, { invitationId, end }),
          );
        },
      ),
  };
}
