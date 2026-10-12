import { assert, setupRitewayBun, test } from 'riteway/bun';
import { observationBaseSchema, observationBaseKey } from './observation';
setupRitewayBun();
const base = {
  schema: 1,
  resource: { kind: 'channel', id: 'a'.repeat(24) },
  partition: { kind: 'shared', policyKey: 'channel-v1' },
  disclosureRevision: 1,
  window: { after: null, limit: 50 },
} as const;
test('semantic identity excludes authority acquisitions', () => {
  const first = observationBaseKey(base);
  assert({
    given: '100 renewals of unchanged canonical disclosure',
    should: 'retain exactly one projection identity',
    actual: new Set(Array.from({ length: 100 }, () => observationBaseKey(base)))
      .size,
    expected: 1,
  });
  assert({
    given: 'a changed disclosure boundary',
    should: 'select a different base',
    actual: first === observationBaseKey({ ...base, disclosureRevision: 2 }),
    expected: false,
  });
});
test('inbox partition binds the actor and bounded windows', () => {
  const inbox = { ...base, resource: { kind: 'inbox', id: base.resource.id } };
  assert({
    given: 'shared inbox, mismatched actor or excessive window',
    should: 'refuse all unsafe bases',
    actual: [
      observationBaseSchema.safeParse(inbox).success,
      observationBaseSchema.safeParse({
        ...inbox,
        partition: { kind: 'actor', actorId: 'b'.repeat(24) },
      }).success,
      observationBaseSchema.safeParse({
        ...base,
        window: { after: null, limit: 51 },
      }).success,
    ],
    expected: [false, false, false],
  });
});

test('windows retain owning sequence and identifier cursor contracts', () => {
  assert({
    given: 'channel sequence history and actor inbox keysets',
    should: 'accept each owning cursor only for its own resource',
    actual: [
      observationBaseSchema.safeParse({
        ...base,
        window: { after: 12, limit: 50 },
      }).success,
      observationBaseSchema.safeParse({
        ...base,
        window: { after: 'b'.repeat(24), limit: 50 },
      }).success,
      observationBaseSchema.safeParse({
        ...base,
        resource: { kind: 'inbox', id: base.resource.id },
        partition: { kind: 'actor', actorId: base.resource.id },
        window: { after: 12, limit: 50 },
      }).success,
    ],
    expected: [true, false, false],
  });
});
