import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { erasePrivacySubject } from '../src/privacy';
import { createAuthorizationSubject } from './authorization.test-support';
import { rejectedBy, withFixture } from './constraint-helpers';
import { played } from './member-profile.test-support';
import { bindings, now } from './privacy.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

/** No Room is open in this proof, so the engine's transitions never run. */
const rooms = {
  closeRoom: <T>(room: T) => room,
  eraseSeats: <T>(room: T) => room,
  activeRoomMembers: () => [],
};

test('closing an account through every feature step keeps the competitive record and what alt detection matches on (ADR 0087)', async () => {
  await withFixture(url, async (fixture) => {
    const subject = await createAuthorizationSubject(fixture);
    const email = `${subject.userId}@closure.invalid`;
    await fixture.sql`update users set email=${email}, name='Private name', image='private-image' where id=${subject.userId}`;
    const recipientHash = createId().padEnd(64, '0');
    await fixture.sql`insert into email_suppression (recipient_hash, reason, provider_message_id)
      values (${recipientHash}, 'bounce', ${createId()})`;
    const round = await played(fixture, {
      member: subject.actorId,
      side: 'affirmative',
      outcome: 'affirmative',
      day: 1,
    });
    const resolution = async () =>
      (await fixture.sql`select resolution from rounds where id=${round.id}`)[0]
        ?.resolution;
    const before = await resolution();
    try {
      const result = await erasePrivacySubject(
        drizzle({ client: fixture.sql }),
        { subject, now, vendors: [], jobIds: [] },
        rooms,
        bindings,
      );
      const [account] =
        await fixture.sql`select id, username, email, name, image, deleted_at is not null as closed from users where id=${subject.userId}`;
      const [actor] =
        await fixture.sql`select user_id from actors where id=${subject.actorId}`;
      const [suppression] =
        await fixture.sql`select count(*)::int as n from email_suppression where recipient_hash=${recipientHash}`;
      const [beta] =
        await fixture.sql`select count(*)::int as n from account_beta_access where user_id=${subject.userId}`;
      const reclaim = await rejectedBy(() =>
        fixture.insert('users', { id: createId(), username: subject.userId }),
      );
      assert({
        given:
          'a member with an email, a bounce suppression, beta access and a played Round',
        should:
          'delete the email, name, image and beta state, and keep the account row id, username, actor link, suppression hash and resolution, with the username never reclaimable',
        actual: {
          alreadyErased: result.alreadyErased,
          account,
          actor: actor?.user_id,
          suppression: suppression?.n,
          beta: beta?.n,
          resolution: await resolution(),
          reclaim,
        },
        expected: {
          alreadyErased: false,
          account: {
            id: subject.userId,
            username: subject.userId,
            email: null,
            name: '',
            image: null,
            closed: true,
          },
          actor: subject.userId,
          suppression: 1,
          beta: 0,
          resolution: before,
          reclaim: 'users_username_lower_unique',
        },
      });
    } finally {
      await fixture.sql`delete from email_suppression where recipient_hash=${recipientHash}`;
    }
  });
});
