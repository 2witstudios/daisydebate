import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { fixedClock } from '@daisy/clock';
import type { ContactStore } from '@daisy/db/contacts';
import { blockContact, blockContactByUsername } from './block';
import { contactCommandDigest } from './digest';

setupRitewayBun();

const me = 'a'.repeat(24),
  them = 'b'.repeat(24),
  requestId = 'r'.repeat(24);
const principal = {
  kind: 'user' as const,
  userId: 'u'.repeat(24),
  actorId: me,
};
const now = '2026-10-28T02:00:00.000Z';
const command = { version: 1, requestId, otherActorId: them, blocked: true };

/** A store whose one frame holds `receipt`, recording what reaches it. */
const fakeStore = (
  receipt: { kind: string; digest: string } | null,
  calls: unknown[],
): ContactStore => ({
  withContacts: async (input, work) => {
    calls.push(['input', input]);
    return work({
      contacts: [
        { lowActorId: me, highActorId: them, blocked: true, revision: 4 },
      ],
      blocking: true,
      readReceipt: async () => receipt,
      commitBlock: async (block) => {
        calls.push(['commit', block]);
        return { blocked: block.blocked, revision: 5 };
      },
    });
  },
});
const dependencies = (store: ContactStore, calls: unknown[]) => ({
  store,
  clock: fixedClock(now),
  limit: async (actorId: string) => {
    calls.push(['limit', actorId]);
  },
});
const digest = contactCommandDigest('contact.block', [them, true]);

test('a fresh block spends the budget, then commits the bound choice on the pair', async () => {
  const calls: unknown[] = [];
  const result = await blockContact(
    command,
    principal,
    dependencies(fakeStore(null, calls), calls),
  );
  assert({
    given: 'a new request to block another member',
    should:
      'lock both members, spend the caller’s block budget, and commit the digest-bound choice',
    actual: [result, calls],
    expected: [
      { blocked: true, revision: 5 },
      [
        [
          'input',
          { actorId: me, userId: principal.userId, memberActorIds: [me, them] },
        ],
        ['limit', me],
        ['commit', { requestId, blocked: true, digest, now }],
      ],
    ],
  });
});

test('a replayed request answers its result; a changed choice under it conflicts', async () => {
  const calls: unknown[] = [];
  const replay = await blockContact(
    command,
    principal,
    dependencies(fakeStore({ kind: 'contact.block', digest }, calls), calls),
  );
  assert({
    given: 'the same request again',
    should: 'answer the pair’s current state without spending or writing',
    actual: [
      replay,
      calls.filter((call) => (call as unknown[])[0] !== 'input'),
    ],
    expected: [{ blocked: true, revision: 4 }, []],
  });
  await assertRejects({
    given: 'an unblock under the request ID of a block',
    should: 'refuse as a conflict',
    actual: () =>
      blockContact(
        { ...command, blocked: false },
        principal,
        dependencies(fakeStore({ kind: 'contact.block', digest }, []), []),
      ),
    code: 'CONFLICT',
  });
});

test('blocking yourself, or a command naming the blocker, is refused', async () => {
  await assertRejects({
    given: 'a block of the caller’s own actor',
    should: 'refuse as invalid before any store work',
    actual: () =>
      blockContact(
        { ...command, otherActorId: me },
        principal,
        dependencies(fakeStore(null, []), []),
      ),
    code: 'VALIDATION',
  });
  await assertRejects({
    given: 'a command that names the blocking actor',
    should: 'refuse caller-supplied authority',
    actual: () =>
      blockContact(
        { ...command, actorId: me },
        principal,
        dependencies(fakeStore(null, []), []),
      ),
    code: 'VALIDATION',
  });
});

test('a block by username resolves through the discovery port, then refuses an unknown name like any denied pair', async () => {
  const calls: unknown[] = [];
  const byName = (lookup: (name: string) => Promise<string | null>) =>
    blockContactByUsername(
      { version: 1, requestId, username: 'Peer', blocked: true },
      principal,
      {
        ...dependencies(fakeStore(null, calls), calls),
        discover: async (actorId, name) => {
          calls.push(['discover', actorId, name]);
          return lookup(name);
        },
      },
    );
  const found = await byName(async () => them);
  assert({
    given: 'a block of a known username',
    should:
      'resolve the name as the caller, then block the proposed actor through the fence',
    actual: [found, calls.slice(0, 2)],
    expected: [
      { blocked: true, revision: 5 },
      [
        ['discover', me, 'peer'],
        [
          'input',
          { actorId: me, userId: principal.userId, memberActorIds: [me, them] },
        ],
      ],
    ],
  });
  await assertRejects({
    given: 'a username no member holds',
    should: 'refuse exactly as an unauthorized pair is refused',
    actual: () => byName(async () => null),
    code: 'AUTHORIZATION',
  });
});
