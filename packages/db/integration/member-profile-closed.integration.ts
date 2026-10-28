import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAuthorizationSubject } from './authorization.test-support';
import {
  played,
  present,
  profileOf,
  roomRound,
  tally,
  withProfileFixture,
} from './member-profile.test-support';
import { at } from './standings-fixtures';

setupRitewayBun();

test('a closed member keeps a profile with only the public subset, for everyone (ADR 0087)', async () => {
  await withProfileFixture(async ({ fixture, database, subject }) => {
    const member = subject.actorId;
    const username = subject.userId;
    const open = await played(fixture, {
      member,
      side: 'affirmative',
      outcome: 'affirmative',
      day: 1,
    });
    await played(fixture, {
      member,
      side: 'negative',
      outcome: 'affirmative',
      day: 2,
      visibility: 'private',
    });
    const reader = await createAuthorizationSubject(fixture);
    const lost = await roomRound(fixture, {
      status: 'completed',
      outcome: 'negative',
      started_at: at(3, 11),
      completed_at: at(3),
    });
    await fixture.participant(lost, 'affirmative', 0, member);
    await fixture.participant(lost, 'negative', 0, reader.actorId);
    await fixture.sql`update users set email=null, name='', image=null,
        deleted_at=${at(4)} where id=${subject.userId}`;
    const visitor = await present(
      profileOf(database, { username, caller: null }),
    );
    const asThemself = await present(
      profileOf(database, { username, caller: subject }),
    );
    const readerView = await present(
      profileOf(database, { username: reader.userId, caller: reader }),
    );
    assert({
      given:
        'a closed member with a public and a private Round, read by a visitor and by a caller bound to the closed actor',
      should:
        'name them, mark them closed and show only the public Rounds and tally to both',
      actual: [
        visitor.member.username,
        visitor.member.closed,
        visitor.scope,
        visitor.rows.map((r) => r.roundId),
        asThemself.scope,
        asThemself.rows.map((r) => r.roundId),
        tally(asThemself.groups),
      ],
      expected: [
        username,
        true,
        'public',
        [lost, open.id],
        'public',
        [lost, open.id],
        ['affirmative:affirmative:1', 'affirmative:negative:1'],
      ],
    });
    assert({
      given: 'another member who debated the closed member',
      should: 'name the closed opponent on their history, marked closed',
      actual: readerView.rows[0]?.seats.find((s) => s.role === 'affirmative'),
      expected: {
        role: 'affirmative',
        kind: 'human',
        label: username,
        closed: true,
      },
    });
  });
});
