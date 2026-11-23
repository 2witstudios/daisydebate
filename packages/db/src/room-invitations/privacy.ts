import { roomInvitationStates } from '@daisy/protocol/room-invitations';
import { idSchema } from '@daisy/protocol/primitives';
import { sql } from 'drizzle-orm';
import type { PrivacyAdopter, PrivacyExport } from '../privacy/contracts';
import { exportRows, run, query } from '../raw-rows';
import { z } from 'zod';

/**
 * Room invitations' subject rights (ADR 0124): every invitation naming the
 * subject, sent or received. Erasure deletes them (their notifications go
 * with them) and frees any seat they held.
 */
export const roomInvitationsPrivacyAdopter: PrivacyAdopter = {
  id: 'room-invitations',
  phase: 'after-close',
  async erase(tx, subject) {
    const actorId = idSchema.parse(subject.actorId);
    await run(
      tx,
      sql`delete from room_seat_holds h using room_invitations i
      where i.state='pending' and h.room_id=i.room_id and h.actor_id=i.invitee_actor_id
        and (i.invitee_actor_id=${actorId} or i.inviter_actor_id=${actorId})`,
    );
    await run(
      tx,
      sql`delete from room_invitations where invitee_actor_id=${actorId} or inviter_actor_id=${actorId}`,
    );
  },
  async export(tx, subject): Promise<PrivacyExport> {
    const actorId = idSchema.parse(subject.actorId);
    return {
      room_invitations: exportRows(
        await query(
          tx,
          z.object({
            room_id: z.string(),
            seat: z.string(),
            state: z.enum(roomInvitationStates),
            received: z.boolean(),
            expires_at: z.date(),
            ended_at: z.date().nullable(),
            created_at: z.date(),
          }),
          sql`select room_id,seat,state,(invitee_actor_id=${actorId}) as received,expires_at,ended_at,created_at
            from room_invitations where invitee_actor_id=${actorId} or inviter_actor_id=${actorId}
            order by created_at,id`,
        ),
      ),
    };
  },
};
