import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  fixture,
  identity,
  payload,
} from './necessary-evidence-custody-fixture.test-support';
setupRitewayBun();
requireTestServices(process.env);
const scope = { roundId: 'd'.repeat(24), subjectActorIds: ['e'.repeat(24)] };

test('a custody identity cannot silently change its original privacy scope', async () => {
  await fixture(async ({ connect }) => {
    const custody = connect();
    const sealed = await custody.seal(identity, payload, scope);
    const changed = await custody.seal(identity, payload, {
      ...scope,
      roundId: 'f'.repeat(24),
    });
    const original =
      sealed.kind === 'sealed' ? await custody.open(sealed) : sealed;
    assert({
      given:
        'the same evidence ID/body/binding retried with a different Round privacy scope',
      should:
        'refuse scope replacement and preserve the usable original without minting new identity/expiry',
      actual: [
        sealed.kind,
        changed.kind,
        changed.kind === 'refused' ? changed.reason : null,
        original.kind,
      ],
      expected: ['sealed', 'refused', 'conflict', 'opened'],
    });
  });
});

test('malformed privacy scope is refused before custody acquisition', async () => {
  await fixture(async ({ authority, connect }) => {
    let reservations = 0;
    const custody = connect({
      ...authority,
      reserve: (...args) => {
        reservations++;
        return authority.reserve(...args);
      },
    });
    const inputs = [
      {},
      { ...scope, roundId: 'invalid' },
      { ...scope, subjectActorIds: ['z'.repeat(24), 'e'.repeat(24)] },
      { ...scope, subjectActorIds: ['e'.repeat(24), 'e'.repeat(24)] },
      { ...scope, subjectActorIds: Array(258).fill('e'.repeat(24)) },
    ];
    const replies = [];
    for (const input of inputs) {
      const reply = await custody.seal(identity, payload, input as never);
      replies.push(reply.kind === 'refused' ? reply.reason : reply.kind);
    }
    assert({
      given:
        'missing/malformed Round scope, unsorted/duplicate subjects or an oversized subject set',
      should: 'refuse every scope before authority or key acquisition',
      actual: { replies, reservations },
      expected: { replies: inputs.map(() => 'invalid'), reservations: 0 },
    });
  });
});

const intent = {
  intentId: 'g'.repeat(24),
  scope: {
    kind: 'subject' as const,
    actorId: scope.subjectActorIds[0]!,
    userId: 'h'.repeat(24),
  },
  authorizationDigest: '1'.repeat(64),
};

test('accepted pending privacy work fences use and acquisition without deleting uncertain material', async () => {
  await fixture(async ({ authority, connect }) => {
    const custody = connect();
    const sealed = await custody.seal(identity, payload, scope);
    if (sealed.kind !== 'sealed')
      throw new Error('Expected synthetic sealed fixture');
    const prepared = authority.preparePrivacy(intent);
    const opened = await custody.open(sealed);
    const inspected = await custody.inspect(identity, scope);
    const acquired = await custody.seal(
      { ...identity, evidenceId: 'i'.repeat(24) },
      payload,
      scope,
    );
    const pendingSweep = custody.sweep(10);
    const committed = authority.commitPrivacy(intent);
    const revoked = await custody.open(sealed);
    const completedSweep = custody.sweep(10);
    assert({
      given:
        'a durably accepted subject erasure intent before canonical mutation/retirement integration',
      should:
        'deny future raw use and new keys while pending, retain uncertain material, then permit cleanup after sticky commit',
      actual: [
        prepared.kind,
        opened,
        inspected,
        acquired,
        pendingSweep,
        committed.kind,
        revoked,
        completedSweep,
      ],
      expected: [
        'pending',
        { kind: 'refused', reason: 'uncertain' },
        { kind: 'refused', reason: 'uncertain' },
        { kind: 'refused', reason: 'uncertain' },
        { removed: 0, blocked: 1 },
        'committed',
        { kind: 'refused', reason: 'revoked' },
        { removed: 1, blocked: 0 },
      ],
    });
  });
});

test('privacy inspection checks original scope and returns no reusable plaintext capability', async () => {
  await fixture(async ({ connect }) => {
    const custody = connect();
    const sealed = await custody.seal(identity, payload, scope);
    const original = await custody.inspect(identity, scope);
    const changed = await custody.inspect(identity, {
      ...scope,
      subjectActorIds: [],
    });
    assert({
      given:
        'an original receipt and a caller attempting to omit its original content subject',
      should:
        'refuse the changed scope and return only receipt/digest for the current original',
      actual: [
        sealed.kind,
        original.kind,
        original.kind === 'available' ? Object.keys(original).sort() : [],
        changed,
      ],
      expected: [
        'sealed',
        'available',
        ['kind', 'payloadDigest', 'receipt'],
        { kind: 'refused', reason: 'conflict' },
      ],
    });
  });
});
