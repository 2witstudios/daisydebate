import { SQL } from 'bun';
import { z } from 'zod';
import {
  canManageBilling,
  canPurchaseClub,
  clubSeatGrants,
  subscriptionGrants,
} from '@daisy/auth/authorization';
import { fundTestClub } from '@daisy/db/testing';
import { releaseAdmission } from '../../src/features/flags/admission';
import { betaAccessTarget } from './beta-access-target';

/**
 * The browser suite's stand-in for an owner buying a Club plan (ADR 0148):
 * opens the `club-seats` release, then funds a club for the manager through
 * the real purchase, inbox and reconciliation stores, on the e2e database as
 * its loopback `daisy_e2e` login only. Stripe is never called.
 */
const input = z
  .strictObject({
    managerEmail: z.email(),
    name: z.string().min(2).max(80),
    seats: z.number().int().min(1).max(10),
  })
  .parse(JSON.parse(await Bun.stdin.text()));
const url = betaAccessTarget(process.env);
const client = new SQL(url, { max: 1 });
try {
  const [identity] =
    await client`select current_database() as database, current_user as role`;
  if (
    identity?.database !== new URL(url).pathname.slice(1) ||
    identity?.role !== 'daisy_e2e'
  )
    throw new Error('Club seat connection identity refused');
  await client`insert into release_flags (key, state, revision) values ('club-seats', 'enabled', 1)
    on conflict (key) do update set state = 'enabled', revision = release_flags.revision + 1
    where release_flags.state <> 'enabled'`;
  const [owner] = (await client`select u.id as user_id, a.id as actor_id
    from users u join actors a on a.user_id = u.id and a.kind = 'human'
    where u.email = ${input.managerEmail}`) as {
    user_id: string;
    actor_id: string;
  }[];
  if (!owner) throw new Error('No account for that address');
  const organizationId = await fundTestClub(client, {
    owner: { userId: owner.user_id, actorId: owner.actor_id },
    name: input.name,
    seats: input.seats,
    policies: {
      purchase: canPurchaseClub,
      manage: canManageBilling,
      release: releaseAdmission('club-seats', false),
    },
    grants: { account: subscriptionGrants, club: clubSeatGrants },
  });
  process.stdout.write(JSON.stringify({ organizationId }));
} finally {
  await client.close();
}
