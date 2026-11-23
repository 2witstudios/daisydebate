import { openWebDatabase } from '../src/server/database';
import { hostWaits } from '@daisy/worker/host';
import { createId } from '@paralleldrive/cuid2';
import { clubSeatGrants } from '@daisy/auth/authorization';
import type { SubscriptionEvidence } from '@daisy/protocol/billing';
import { noopErrorReporter } from '@daisy/observability';
import { withSql, testDatabaseUrl } from './fixtures';
import { silentLogger } from '../src/server/test-loggers.test-support';
import {
  composeClubRoutes,
  type ClubRouteDependencies,
} from '../src/features/clubs/routes';
import { createClubSeatCommands } from '../src/features/clubs/invitation-resend';

/** Real fenced store and application policy, with only external route collaborators unused. */
export async function withClub(
  work: (input: {
    sql: Parameters<Parameters<typeof withSql>[0]>[0];
    database: ReturnType<typeof openWebDatabase>;
    owner: { userId: string; actorId: string };
    organizationId: string;
    paid: SubscriptionEvidence;
    store: ReturnType<ReturnType<typeof openWebDatabase>['clubSeats']>;
    seats: ReturnType<typeof createClubSeatCommands>;
    post: (command: unknown) => Promise<Response>;
    person: () => Promise<{ userId: string; actorId: string; email: string }>;
    answerPost: (
      subject: { userId: string; actorId: string },
      invitationId: string,
      answer: 'accept' | 'decline',
    ) => Promise<Response>;
  }) => Promise<void>,
) {
  await withSql(async (sql) => {
    const database = openWebDatabase({
      waits: hostWaits,
      url: testDatabaseUrl,
      nextActorId: createId,
    });
    const owner = { userId: createId(), actorId: createId() };
    const people: { userId: string; actorId: string }[] = [];
    const person = async () => {
      const subject = { userId: createId(), actorId: createId() };
      people.push(subject);
      const email = `${subject.userId}@invitee.invalid`;
      await sql`insert into users(id,username,email,email_verified) values(${subject.userId},${subject.userId},${email},true)`;
      await sql`insert into actors(id,kind,user_id) values(${subject.actorId},'human',${subject.userId})`;
      return { ...subject, email };
    };
    const organizationId = createId();
    const subscriptionId = createId();
    const [clock] = await sql`select clock_timestamp() as now`;
    const now = (clock!.now as Date).getTime();
    const paid: SubscriptionEvidence = {
      lifecycle: 'active',
      settlement: {
        kind: 'paid',
        invoiceId: `in_${createId()}`,
        period: {
          subscriptionId,
          startsAt: new Date(now - 86400000).toISOString(),
          endsAt: new Date(now + 29 * 86400000).toISOString(),
        },
      },
    };
    const store = database.clubSeats(clubSeatGrants);
    const seats = createClubSeatCommands(store);
    const origin = 'https://daisy.example';
    const unused = async (): Promise<never> => {
      throw new Error('Unrelated Club route collaborator used');
    };
    const deps: ClubRouteDependencies = {
      boundary: {
        logger: silentLogger,
        reporter: noopErrorReporter,
        origin: () => origin,
        identify: async () => ({
          state: 'member',
          username: owner.userId,
          principal: { kind: 'user', ...owner },
        }),
        limiter: () => ({
          consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
        }),
      },
      configured: true,
      released: async () => true,
      seats,
      reads: database.clubSeatReads,
      billing: {
        checkout: unused,
        portal: unused,
        changeSeats: unused,
        invoices: unused,
        ownPremium: unused,
      },
      createClub: unused,
    };
    const routes = composeClubRoutes(deps);
    const post = (command: unknown) =>
      routes.seats.POST(
        new Request(`${origin}/api/clubs/${organizationId}/seats`, {
          method: 'POST',
          headers: { origin, 'content-type': 'application/json' },
          body: JSON.stringify(command),
        }),
        organizationId,
      );
    const answerPost = (
      subject: { userId: string; actorId: string },
      invitationId: string,
      answer: 'accept' | 'decline',
    ) =>
      composeClubRoutes({
        ...deps,
        boundary: {
          ...deps.boundary,
          identify: async () => ({
            state: 'member',
            username: subject.userId,
            principal: { kind: 'user', ...subject },
          }),
        },
      }).invitation.POST(
        new Request(
          `${origin}/api/clubs/invitations/${organizationId}.${invitationId}`,
          {
            method: 'POST',
            headers: { origin, 'content-type': 'application/json' },
            body: JSON.stringify({ answer }),
          },
        ),
        `${organizationId}.${invitationId}`,
      );
    try {
      await sql`insert into users(id,username,email_verified) values(${owner.userId},${owner.userId},true)`;
      await sql`insert into actors(id,kind,user_id) values(${owner.actorId},'human',${owner.userId})`;
      await sql`insert into organizations(id,kind,name,handle,owner_user_id) values(${organizationId},'school','Club resend proof',${organizationId},${owner.userId})`;
      await sql`insert into memberships(organization_id,user_id,status,joined_at) values(${organizationId},${owner.userId},'active',now())`;
      await sql`insert into billing_subscriptions(id,organization_id,vendor_subscription_id,evidence,current,seat_count,observed_at) values(${subscriptionId},${organizationId},${`sub_${createId()}`},${paid},true,2,now())`;
      await work({
        sql,
        database,
        owner,
        organizationId,
        paid,
        store,
        seats,
        post,
        person,
        answerPost,
      });
    } finally {
      await database.close();
      await sql`delete from mail_intents where dedupe_key like ${`club-seat-invitation:${organizationId}:%`}`;
      await sql`delete from club_seat_invitations where organization_id=${organizationId}`;
      await sql`delete from club_seats where organization_id=${organizationId}`;
      await sql`delete from account_entitlement_grants where organization_id=${organizationId}`;
      await sql`delete from billing_purchases where organization_id=${organizationId}`;
      await sql`delete from billing_subscriptions where organization_id=${organizationId}`;
      await sql`delete from billing_customers where organization_id=${organizationId}`;
      await sql`delete from memberships where organization_id=${organizationId}`;
      await sql`delete from organizations where id=${organizationId}`;
      await sql`delete from actors where id=${owner.actorId}`;
      await sql`delete from users where id=${owner.userId}`;
      for (const subject of people) {
        await sql`delete from actors where id=${subject.actorId}`;
        await sql`delete from users where id=${subject.userId}`;
      }
    }
  });
}
