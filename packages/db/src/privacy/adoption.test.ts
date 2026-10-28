import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { subjectRightsAdoption } from './adoption';
import type { PrivacyAdopter } from './contracts';

setupRitewayBun();

const rooms = {
  closeRoom: <T>(room: T) => room,
  eraseSeats: <T>(room: T) => room,
  activeRoomMembers: () => [],
};
const adoption = subjectRightsAdoption(rooms);

/** The subject-rights machinery itself, which defines no feature step. */
const machinery = new Set([
  'privacy/contracts.ts',
  'privacy/planner.ts',
  'privacy/operations.ts',
  'privacy/subject-rights.ts',
  'privacy/adoption.ts',
  'privacy/index.ts',
  'social-privacy-composition.ts',
]);

const isStep = (value: unknown): value is PrivacyAdopter =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as PrivacyAdopter).id === 'string' &&
  typeof (value as PrivacyAdopter).erase === 'function' &&
  typeof (value as PrivacyAdopter).export === 'function';

/**
 * Every step a feature module exports, found by importing each module that
 * names `PrivacyAdopter` and reading its exports: a step object, or a
 * factory whose result is one. A module that names the type and exports no
 * step fails the test rather than being skipped.
 */
const definedSteps = async () => {
  const root = join(import.meta.dir, '..');
  const files = (readdirSync(root, { recursive: true }) as string[]).filter(
    (file) =>
      file.endsWith('.ts') &&
      !file.endsWith('.test.ts') &&
      !file.includes('test-') &&
      !machinery.has(file) &&
      readFileSync(join(root, file), 'utf8').includes('PrivacyAdopter'),
  );
  // A barrel re-exports a step; each exported value counts once.
  const seen = new Map<unknown, string>();
  const steps = await Promise.all(
    files.map(async (file) => {
      const ids: string[] = [];
      for (const value of Object.values(
        (await import(join(root, file))) as Record<string, unknown>,
      )) {
        const step =
          typeof value === 'function' && value.name.endsWith('Adopter')
            ? (value as (input: typeof rooms) => unknown)(rooms)
            : value;
        if (!isStep(step)) continue;
        ids.push(step.id);
        seen.set(value, step.id);
      }
      return { file, ids };
    }),
  );
  return { steps, ids: [...seen.values()].sort() };
};

test('the subject-rights composition runs every feature step exactly once', async () => {
  const { steps, ids } = await definedSteps();
  assert({
    given: 'every module that names PrivacyAdopter',
    should: 'export at least one step',
    actual: steps.filter(({ ids }) => ids.length === 0).map(({ file }) => file),
    expected: [],
  });
  assert({
    given: 'every step a feature module exports',
    should: 'appear in the canonical composition exactly once',
    actual: adoption.map((adopter) => adopter.id).sort(),
    expected: ids,
  });
  assert({
    given: 'the canonical composition',
    should:
      'close Rooms and Messaging before sign-in rows go, and erase Contacts after the other social steps',
    actual: adoption.map((adopter) => `${adopter.phase}:${adopter.id}`),
    expected: [
      'before-auth:room-closure',
      'before-auth:messaging',
      'after-close:friends',
      'after-close:presence',
      'after-close:contacts',
      'after-close:onboarding',
      'after-close:account-age',
      'after-close:account-terms',
      'after-close:beta-access',
      'after-close:entitlement-grants',
      'after-close:round-transcript',
      'after-close:round-analysis',
    ],
  });
});
