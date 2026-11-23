import { hostWaits } from '@daisy/worker/host';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { finishedOrBlockedBehind } from '@daisy/db/testing';
import {
  decideClubSeating,
  type SeatInvitation,
} from '@daisy/protocol/club-seats';
import { withClub } from './club-manager.test-support';

setupRitewayBun();
test('an invitee session cannot claim success without applying the invitation', async () => {
  await withClub(async ({ sql, owner, organizationId, store, post }) => {
    const email = `${owner.userId}@invitee.invalid`;
    await sql`update users set email=${email} where id=${owner.userId}`;
    await post({ kind: 'invite', email });
    const [invitation] =
      await sql`select id from club_seat_invitations where organization_id=${organizationId}`;
    const result = await store
      .answerCommand(
        owner,
        organizationId,
        invitation!.id as string,
        'accept',
        async (session) => {
          await session.load();
          return { kind: 'changed' };
        },
      )
      .then(
        () => 'committed',
        (error: { code: string }) => error.code,
      );
    const [effects] =
      await sql`select (select count(*)::int from club_seats where organization_id=${organizationId}) as seats,(select count(*)::int from club_seat_invitations where organization_id=${organizationId}) as invitations,(select count(*)::int from mail_intents where dedupe_key like ${`club-seat-invitation:${organizationId}:%`} and state='queued') as mail`;
    assert({
      given: 'a loaded answer whose caller returns success without applying',
      should:
        'reject missing settlement while retaining invitation and owed mail',
      actual: [result, effects],
      expected: ['INVARIANT', { seats: 0, invitations: 1, mail: 1 }],
    });
  });
});

test('the actual invitee route preserves addressed admission and atomically accepts with membership and grants', async () => {
  await withClub(async ({ sql, organizationId, post, person, answerPost }) => {
    const invitee = await person(),
      stranger = await person();
    await post({ kind: 'invite', email: invitee.email.toUpperCase() });
    const [invitation] =
      await sql`select id from club_seat_invitations where organization_id=${organizationId}`;
    const id = invitation!.id as string;
    const foreign = await answerPost(stranger, id, 'accept');
    await sql`update users set email_verified=false where id=${invitee.userId}`;
    const unverified = await answerPost(invitee, id, 'accept');
    await sql`update users set email_verified=true where id=${invitee.userId}`;
    const accepted = await answerPost(invitee, id, 'accept');
    const [facts] =
      await sql`select (select count(*)::int from club_seats where organization_id=${organizationId} and user_id=${invitee.userId}) as seats,(select count(*)::int from club_seat_invitations where organization_id=${organizationId}) as invitations,(select status from memberships where organization_id=${organizationId} and user_id=${invitee.userId}) as membership,(select count(*)::int from membership_periods where organization_id=${organizationId} and user_id=${invitee.userId} and ended_at is null) as periods,(select count(*)::int from account_entitlement_grants where organization_id=${organizationId} and user_id=${invitee.userId}) as grants,(select count(*)::int from mail_intents where club_seat_invitation_id=${id} and state='queued') as owed`;
    assert({
      given:
        'a foreign account, unverified invitee and then verified invitee through the real application route',
      should:
        'preserve 404 admission and atomically convert only the addressed invitation into seat, membership, period and five grants',
      actual: [
        foreign.status,
        unverified.status,
        accepted.status,
        await accepted.json(),
        facts,
      ],
      expected: [
        404,
        404,
        200,
        { kind: 'changed' },
        {
          seats: 1,
          invitations: 0,
          membership: 'active',
          periods: 1,
          grants: 5,
          owed: 0,
        },
      ],
    });
  });
});

test('inactive invitation acceptance does not invent funded access and an expired invitation can still be declined', async () => {
  await withClub(
    async ({ sql, organizationId, paid, post, person, answerPost }) => {
      const invitee = await person(),
        declining = await person();
      await post({ kind: 'invite', email: invitee.email });
      await post({ kind: 'invite', email: declining.email });
      const invitations = await sql<
        Pick<SeatInvitation, 'id' | 'email'>[]
      >`select id,email from club_seat_invitations where organization_id=${organizationId}`;
      const acceptedId = invitations.find((i) => i.email === invitee.email)!
        .id as string;
      const declinedId = invitations.find((i) => i.email === declining.email)!
        .id as string;
      await sql`update billing_subscriptions set evidence=${{ ...paid, lifecycle: 'canceled' }} where organization_id=${organizationId}`;
      await sql`update club_seat_invitations set created_at=now()-interval '15 days',expires_at=now()-interval '1 day' where id=${declinedId}`;
      const expired = await answerPost(declining, declinedId, 'accept');
      const declined = await answerPost(declining, declinedId, 'decline');
      const accepted = await answerPost(invitee, acceptedId, 'accept');
      const [effects] =
        await sql`select (select count(*)::int from club_seats where organization_id=${organizationId}) as seats,(select count(*)::int from club_seat_invitations where organization_id=${organizationId}) as invitations,(select count(*)::int from account_entitlement_grants where organization_id=${organizationId}) as grants,(select count(*)::int from mail_intents where dedupe_key like ${`club-seat-invitation:${organizationId}:%`} and state='queued') as owed`;
      assert({
        given:
          'an inactive plan, one expired invitation and one live invitation',
        should:
          'retain expiry refusal for accept, permit expired decline and live accept without granting unfunded Premium',
        actual: [
          expired.status,
          await expired.json(),
          await declined.json(),
          await accepted.json(),
          effects,
        ],
        expected: [
          200,
          { kind: 'refused', reason: 'invitation-expired' },
          { kind: 'changed' },
          { kind: 'changed' },
          { seats: 1, invitations: 0, grants: 0, owed: 0 },
        ],
      });
    },
  );
});

test('an invitee delayed behind the account fence uses the current verified address', async () => {
  await withClub(async ({ sql, organizationId, post, person, answerPost }) => {
    const invitee = await person();
    await post({ kind: 'invite', email: invitee.email });
    const [invitation] =
      await sql`select id from club_seat_invitations where organization_id=${organizationId}`;
    let response: Promise<Response> | undefined;
    let waited = '';
    try {
      await sql.begin(async (tx) => {
        await tx`select * from public.daisy_authorization_accounts_v2(array[${invitee.actorId}]::text[],null::text,true)`;
        const [holder] = await tx`select pg_backend_pid() as pid`;
        response = answerPost(invitee, invitation!.id as string, 'accept');
        waited = await finishedOrBlockedBehind(response, sql, holder!.pid, {
          waits: hostWaits,
          deadlineMs: 1500,
        });
        await tx`update users set email_verified=false where id=${invitee.userId}`;
      });
      const result = await response!;
      const [effects] =
        await sql`select (select count(*)::int from club_seats where organization_id=${organizationId}) as seats,(select count(*)::int from club_seat_invitations where organization_id=${organizationId}) as invitations`;
      assert({
        given:
          'an acceptance waiting at the real account fence while its address loses verification',
        should:
          'read the new addressed-admission facts and refuse without consuming the invitation',
        actual: [waited, result.status, effects],
        expected: ['blocked', 404, { seats: 0, invitations: 1 }],
      });
    } finally {
      await response?.catch(() => undefined);
    }
  });
});

test('failed invitee application rolls back mail, seating, membership and grants and closes writers', async () => {
  await withClub(async ({ sql, organizationId, post, person, store }) => {
    const invitee = await person();
    await post({ kind: 'invite', email: invitee.email });
    const [invitation] =
      await sql`select id from club_seat_invitations where organization_id=${organizationId}`;
    const id = invitation!.id as string;
    const escaped: { apply?: () => Promise<void> } = {};
    const rejected: string[] = [];
    for (const mode of ['exception', 'refused'] as const) {
      await store
        .answerCommand(
          invitee,
          organizationId,
          id,
          'accept',
          async (session) => {
            const loaded = await session.load();
            const decision = decideClubSeating(
              loaded.before,
              {
                kind: 'accept',
                invitationId: id,
                userId: invitee.userId,
                seatedElsewhere: loaded.elsewhere,
              },
              loaded.now,
            );
            if (decision.kind === 'refused') throw createAppError('INVARIANT');
            escaped.apply = () => loaded.apply(decision.state);
            await loaded.apply(decision.state);
            if (mode === 'exception') throw createAppError('CONFLICT');
            return { kind: 'refused', reason: 'already-seated' };
          },
        )
        .catch((error: { code: string }) => {
          rejected.push(error.code);
        });
    }
    await escaped.apply?.().catch((error: { code: string }) => {
      rejected.push(error.code);
    });
    const [effects] =
      await sql`select (select count(*)::int from club_seats where organization_id=${organizationId}) as seats,(select count(*)::int from club_seat_invitations where organization_id=${organizationId}) as invitations,(select count(*)::int from memberships where organization_id=${organizationId} and user_id=${invitee.userId}) as memberships,(select count(*)::int from membership_periods where organization_id=${organizationId} and user_id=${invitee.userId}) as periods,(select count(*)::int from account_entitlement_grants where organization_id=${organizationId}) as grants,(select count(*)::int from mail_intents where dedupe_key like ${`club-seat-invitation:${organizationId}:%`} and state='queued') as mail`;
    assert({
      given:
        'post-apply exception or incompatible refusal and an escaped writer',
      should:
        'roll back every invitation, seat, membership-period and Premium effect and reject the escaped capability',
      actual: [rejected, effects],
      expected: [
        ['CONFLICT', 'INVARIANT', 'INVARIANT'],
        {
          seats: 0,
          invitations: 1,
          memberships: 0,
          periods: 0,
          grants: 0,
          mail: 1,
        },
      ],
    });
    const repeats: string[] = [];
    await store.answerCommand(
      invitee,
      organizationId,
      id,
      'accept',
      async (session) => {
        const loaded = await session.load();
        const decision = decideClubSeating(
          loaded.before,
          {
            kind: 'accept',
            invitationId: id,
            userId: invitee.userId,
            seatedElsewhere: loaded.elsewhere,
          },
          loaded.now,
        );
        if (decision.kind === 'refused') throw createAppError('INVARIANT');
        await loaded.apply(decision.state);
        for (const repeat of [
          () => session.load(),
          () => loaded.apply(decision.state),
        ])
          await repeat().catch((error: { code: string }) => {
            repeats.push(error.code);
          });
        return { kind: 'changed' };
      },
    );
    assert({
      given: 'a completed invitation application',
      should: 'refuse repeated load and apply',
      actual: repeats,
      expected: ['INVARIANT', 'INVARIANT'],
    });
  });
});
