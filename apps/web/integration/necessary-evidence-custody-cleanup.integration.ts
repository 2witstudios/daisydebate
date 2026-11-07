import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  fixture,
  identity,
  payload,
} from './necessary-evidence-custody-fixture.test-support';
setupRitewayBun();
test('bounded cleanup advances past a live prefix after authority revocation interrupts material deletion', () =>
  fixture(async ({ authority, connect }) => {
    const custody = connect();
    const identities = ['a', 'b', 'c', 'z'].map((letter) => ({
      ...identity,
      evidenceId: letter.repeat(24),
    }));
    for (const scope of identities) {
      const sealed = await custody.seal(scope, payload);
      if (sealed.kind !== 'sealed') throw new Error('Synthetic fixture failed');
    }
    // Actual durable authority commit; the material-delete step never ran.
    authority.revoke(identities[3]!);
    const passes = Array.from({ length: 4 }, () => custody.sweep(1));
    assert({
      given:
        'three earlier live entries before a revoked entry whose material deletion was interrupted',
      should:
        'reach and remove revoked material in four bounded visits without waiting for seven-day expiry',
      actual: passes,
      expected: [
        { removed: 0, blocked: 0 },
        { removed: 0, blocked: 0 },
        { removed: 0, blocked: 0 },
        { removed: 1, blocked: 0 },
      ],
    });
  }));
test('a finite persisted cleanup pass revisits earlier revocations despite new arrivals', () =>
  fixture(async ({ authority, connect }) => {
    let custody = connect();
    const scopes = ['a', 'b', 'c', 'd', 'e', 'f'].map((letter) => ({
      ...identity,
      evidenceId: letter.repeat(24),
    }));
    for (const scope of scopes.slice(0, 3)) await custody.seal(scope, payload);
    const first = custody.sweep(1);
    // Revoke AFTER this item was visited, then restart with the persisted cursor.
    authority.revoke(scopes[0]!);
    custody.close();
    custody = connect();
    await custody.seal(scopes[3]!, payload);
    const second = custody.sweep(1);
    await custody.seal(scopes[4]!, payload);
    const third = custody.sweep(1);
    await custody.seal(scopes[5]!, payload);
    const revisit = custody.sweep(1);
    assert({
      given:
        'a visited key revoked behind the cursor, restart, and fresh material inserted between every subsequent pass',
      should:
        'finish the captured finite pass and revisit the revoked key before original expiry',
      actual: [first, second, third, revisit],
      expected: [
        { removed: 0, blocked: 0 },
        { removed: 0, blocked: 0 },
        { removed: 0, blocked: 0 },
        { removed: 1, blocked: 0 },
      ],
    });
  }));
test('unavailable or uncertain authority retains material and the cleanup retry obligation', () =>
  fixture(async ({ authority, connect }) => {
    const current = connect();
    const sealed = await current.seal(identity, payload);
    if (sealed.kind !== 'sealed') throw new Error('Synthetic fixture failed');
    let reason: 'unavailable' | 'uncertain' = 'unavailable';
    const refused = connect({
      ...authority,
      read: () => ({ kind: 'refused', reason }),
    });
    const unavailable = refused.sweep(1);
    reason = 'uncertain';
    const uncertain = refused.sweep(1);
    const retained = await current.open(sealed);
    authority.revoke(identity);
    const recovered = connect().sweep(1);
    assert({
      given:
        'temporary unavailable/uncertain authority across complete passes, then current revoked authority',
      should:
        'delete nothing on refusal, preserve readable material, and retry cleanup after recovery',
      actual: [unavailable, uncertain, retained.kind, recovered],
      expected: [
        { removed: 0, blocked: 1 },
        { removed: 0, blocked: 1 },
        'opened',
        { removed: 1, blocked: 0 },
      ],
    });
  }));
