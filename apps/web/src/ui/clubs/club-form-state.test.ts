import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  clubAnswer,
  handleFrom,
  seatCommandFrom,
  seatCountFrom,
} from './club-form-state';
import { refusalCopy } from './club-copy';

setupRitewayBun();
const form = (entries: readonly (readonly [string, string])[]) => {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
};
const id = 'a'.repeat(24);

test('a seats-board form becomes exactly one seat command', () => {
  assert({
    given:
      'invite, move to a member, move to someone new, remove and cancel forms',
    should:
      'build the command the seats route takes, and nothing for an empty invite',
    actual: [
      seatCommandFrom(
        form([
          ['kind', 'invite'],
          ['email', ' sam@x.edu '],
        ]),
      ),
      seatCommandFrom(
        form([
          ['kind', 'move'],
          ['fromUserId', id],
          ['to', 'b'.repeat(24)],
        ]),
      ),
      seatCommandFrom(
        form([
          ['kind', 'move'],
          ['fromUserId', id],
          ['to', 'invite'],
          ['email', 'new@x.edu'],
        ]),
      ),
      seatCommandFrom(
        form([
          ['kind', 'remove'],
          ['userId', id],
        ]),
      ),
      seatCommandFrom(
        form([
          ['kind', 'cancel'],
          ['invitationId', id],
        ]),
      ),
      seatCommandFrom(
        form([
          ['kind', 'invite'],
          ['email', ''],
        ]),
      ),
      seatCommandFrom(form([['kind', 'unknown']])),
    ],
    expected: [
      { kind: 'invite', email: 'sam@x.edu' },
      {
        kind: 'move',
        fromUserId: id,
        to: { kind: 'member', userId: 'b'.repeat(24) },
      },
      {
        kind: 'move',
        fromUserId: id,
        to: { kind: 'invite', email: 'new@x.edu' },
      },
      { kind: 'remove', userId: id },
      { kind: 'cancel', invitationId: id },
      null,
      null,
    ],
  });
});

test('a seat-count form names exactly the seats and invitations it gives up', () => {
  assert({
    given: 'a lower count with one seat and one invitation chosen',
    should: 'send both lists',
    actual: seatCountFrom(
      form([
        ['seatCount', '8'],
        ['releaseSeat', id],
        ['releaseInvitation', 'b'.repeat(24)],
      ]),
    ),
    expected: {
      seatCount: 8,
      release: { seats: [id], invitations: ['b'.repeat(24)] },
    },
  });
});

test('a route answer becomes form state; every refusal reads as plain copy', () => {
  const posted = form([
    ['kind', 'invite'],
    ['email', 'sam@x.edu'],
  ]);
  assert({
    given: 'changed, a seat refusal, a payment failure and an unknown answer',
    should:
      'answer done, or refused with that refusal’s copy and the values kept',
    actual: [
      clubAnswer(posted, { kind: 'changed' }).kind,
      clubAnswer(posted, { kind: 'refused', reason: 'seated-elsewhere' }),
      clubAnswer(posted, { kind: 'payment-failed' }),
      clubAnswer(posted, { kind: 'surprise' }),
    ],
    expected: [
      'done',
      {
        kind: 'refused',
        values: { kind: 'invite', email: 'sam@x.edu' },
        error: refusalCopy['seated-elsewhere'],
      },
      {
        kind: 'refused',
        values: { kind: 'invite', email: 'sam@x.edu' },
        error: refusalCopy['payment-failed'],
      },
      {
        kind: 'refused',
        values: { kind: 'invite', email: 'sam@x.edu' },
        error: refusalCopy.unavailable,
      },
    ],
  });
});

test('a club handle comes from its name and steps on when taken', () => {
  assert({
    given:
      'a name with spaces and accents, a short name, a retry, a non-Latin name and a third try',
    should: 'give a valid lower-case handle',
    actual: [
      handleFrom('Lakeside Débate Club!'),
      handleFrom('A'),
      handleFrom('Lakeside Debate', 1),
      handleFrom('北京辩论社', 0, 'x7k2pq'),
      handleFrom('Lakeside Debate', 2, 'x7k2pq'),
    ],
    expected: [
      'lakeside-debate-club',
      'a-club',
      'lakeside-debate-2',
      'club-x7k2pq',
      'lakeside-debate-x7k2pq',
    ],
  });
});
