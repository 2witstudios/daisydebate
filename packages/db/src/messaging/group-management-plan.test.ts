import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { planGroupManagement } from './group-management-plan';

setupRitewayBun();
const manager = 'a'.repeat(24),
  member = 'b'.repeat(24);
const now = '2026-10-10T06:00:00.000Z';
const grants = () => [
  {
    actorId: manager,
    role: 'manager' as const,
    generation: 2,
    grantedAt: new Date('2026-10-09T06:00:00.000Z'),
  },
  {
    actorId: member,
    role: 'member' as const,
    generation: 4,
    grantedAt: new Date('2026-10-09T06:00:00.000Z'),
  },
];

test('group management plans preserve the last-manager invariant without mutating locked facts', () => {
  const current = grants(),
    before = JSON.stringify(current);
  const removal = planGroupManagement({
    operation: 'remove',
    actorId: manager,
    targetActorId: member,
    lifecycle: 'active',
    grants: current,
    now,
  });
  const transfer = planGroupManagement({
    operation: 'transfer',
    actorId: manager,
    targetActorId: member,
    lifecycle: 'active',
    grants: current,
    now,
  });
  const archive = planGroupManagement({
    operation: 'archive',
    actorId: manager,
    lifecycle: 'active',
    grants: current,
    now,
  });
  const leave = planGroupManagement({
    operation: 'leave',
    actorId: manager,
    lifecycle: 'archived',
    grants: current,
    now,
  });
  assert({
    given:
      'actual locked grants and explicit removal, transfer, archive, or archived self-leave',
    should: 'scope generation changes and retain immutable facts',
    actual: [removal, transfer, archive, leave, JSON.stringify(current)],
    expected: [
      {
        lifecycle: 'active',
        changes: [
          {
            actorId: member,
            expectedGeneration: 4,
            generation: 5,
            role: 'member',
            revokedAt: new Date(now),
          },
        ],
      },
      {
        lifecycle: 'active',
        changes: [
          {
            actorId: manager,
            expectedGeneration: 2,
            generation: 3,
            role: 'member',
            revokedAt: null,
          },
          {
            actorId: member,
            expectedGeneration: 4,
            generation: 5,
            role: 'manager',
            revokedAt: null,
          },
        ],
      },
      { lifecycle: 'archived', changes: [] },
      {
        lifecycle: 'archived',
        changes: [
          {
            actorId: manager,
            expectedGeneration: 2,
            generation: 3,
            role: 'manager',
            revokedAt: new Date(now),
          },
        ],
      },
      before,
    ],
  });
});

for (const [label, change] of [
  ['last active manager leaves', { operation: 'leave' as const }],
  ['self removal bypasses leave', { targetActorId: manager }],
  ['missing target', { targetActorId: 'c'.repeat(24) }],
  [
    'archived transfer',
    { operation: 'transfer' as const, lifecycle: 'archived' as const },
  ],
  [
    'generation overflow',
    {
      grants: grants().map((g) => ({
        ...g,
        generation: Number.MAX_SAFE_INTEGER,
      })),
    },
  ],
  ['time precedes grant', { now: '2026-10-08T06:00:00.000Z' }],
] as const) {
  test(`group management refuses ${label} before producing writes`, async () => {
    await assertRejects({
      given: label,
      should: 'refuse an invalid effect plan',
      actual: async () =>
        planGroupManagement({
          operation: 'remove',
          actorId: manager,
          targetActorId: member,
          lifecycle: 'active',
          grants: grants(),
          now,
          ...change,
        }),
      code: 'CONFLICT',
    });
  });
}
