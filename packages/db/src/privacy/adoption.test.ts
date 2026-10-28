import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { subjectRightsAdoption } from './adoption';

setupRitewayBun();

const rooms = {
  closeRoom: <T>(room: T) => room,
  eraseSeats: <T>(room: T) => room,
  activeRoomMembers: () => [],
};
const adoption = subjectRightsAdoption(rooms);

/** Every `PrivacyAdopter` a feature defines under src, by its declared id. */
const definedAdopterIds = () => {
  const root = join(import.meta.dir, '..');
  const files = (readdirSync(root, { recursive: true }) as string[]).filter(
    (file) =>
      file.endsWith('.ts') &&
      !file.endsWith('.test.ts') &&
      !file.includes('test-'),
  );
  return files
    .map((file) => readFileSync(join(root, file), 'utf8'))
    .filter((source) => /\)?: PrivacyAdopter\b(?! \|)/.test(source))
    .flatMap((source) =>
      [...source.matchAll(/^\s*id: '([a-z-]+)',\s*\n\s*phase: '/gm)].map(
        (match) => match[1],
      ),
    )
    .sort();
};

test('the subject-rights composition runs every feature step exactly once', () => {
  assert({
    given: 'every PrivacyAdopter a feature defines',
    should: 'appear in the canonical composition exactly once',
    actual: adoption.map((adopter) => adopter.id).sort(),
    expected: definedAdopterIds(),
  });
  assert({
    given: 'the canonical composition',
    should:
      'close Rooms and Messaging before sign-in rows go, and erase Contacts after the other social steps',
    actual: adoption.map((adopter) => `${adopter.phase}:${adopter.id}`),
    expected: [
      'before-auth:room-closure',
      'before-auth:messaging',
      'after-scrub:friends',
      'after-scrub:presence',
      'after-scrub:contacts',
      'after-scrub:onboarding',
      'after-scrub:account-age',
      'after-scrub:account-terms',
      'after-scrub:beta-access',
      'after-scrub:entitlement-grants',
      'after-scrub:round-transcript',
      'after-scrub:round-analysis',
    ],
  });
});
