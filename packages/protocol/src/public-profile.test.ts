import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  BIO_MAX,
  DISPLAY_NAME_MAX,
  isProfilePhotoTerminal,
  isProfilePhotoVisible,
  normalizeBio,
  normalizeDisplayName,
  profilePhotoSizeSchema,
  profilePhotoTransition,
  profilePhotoStatuses,
  publicProfileEditSchema,
} from './public-profile';

setupRitewayBun();

const edit = (displayName: string, bio: string) =>
  publicProfileEditSchema.safeParse({ version: 1, displayName, bio });

describe('public profile text', () => {
  test('display name normalization', () => {
    assert({
      given: 'a name with a bidi override, zero-width space, control and runs of space',
      should: 'remove what does not render and collapse the spaces',
      actual: normalizeDisplayName('  Ada‮ ​\u0007  Lovelace\n '),
      expected: 'Ada Lovelace',
    });
    assert({
      given: 'a decomposed accent',
      should: 'compose it (NFC)',
      actual: normalizeDisplayName('José'),
      expected: 'José',
    });
  });

  test('bio normalization', () => {
    assert({
      given: 'a bio with CRLF, padded lines and four blank lines',
      should: 'keep paragraphs, at most one blank line between them',
      actual: normalizeBio('  Debater.\r\n\r\n\r\n\r\n  Policy   and LD \t'),
      expected: 'Debater.\n\nPolicy and LD',
    });
  });

  test('the edit schema', () => {
    const parsed = edit('  Ada  ', '');
    assert({
      given: 'a padded name and an empty bio',
      should: 'accept the trimmed name and clear the bio',
      actual: parsed.success ? parsed.data : null,
      expected: { version: 1, displayName: 'Ada', bio: null },
    });
    assert({
      given: 'a name and bio exactly at their limits, counted in code points',
      should: 'accept them',
      actual: edit('😀'.repeat(DISPLAY_NAME_MAX), 'b'.repeat(BIO_MAX)).success,
      expected: true,
    });
    assert({
      given: 'a name or a bio one past its limit',
      should: 'refuse it',
      actual: [
        edit('a'.repeat(DISPLAY_NAME_MAX + 1), '').success,
        edit('', 'b'.repeat(BIO_MAX + 1)).success,
      ],
      expected: [false, false],
    });
    assert({
      given: 'an unknown field',
      should: 'refuse the edit',
      actual: publicProfileEditSchema.safeParse({
        version: 1,
        displayName: '',
        bio: '',
        region: 'Europe',
      }).success,
      expected: false,
    });
  });
});

describe('profile photo lifecycle predicates', () => {
  test('visibility and terminality', () => {
    assert({
      given: 'every status',
      should: 'show the owner in-review and published, others published only',
      actual: profilePhotoStatuses.map((status) => [
        status,
        isProfilePhotoVisible(status, 'owner'),
        isProfilePhotoVisible(status, 'other'),
        isProfilePhotoTerminal(status),
      ]),
      expected: [
        ['in_review', true, false, false],
        ['published', true, true, false],
        ['rejected', false, false, true],
        ['removed', false, false, true],
        ['withdrawn', false, false, true],
        ['erased', false, false, true],
      ],
    });
  });

  test('rendition sizes', () => {
    assert({
      given: 'the stored sizes and an arbitrary one, as path text',
      should: 'accept only the stored sizes',
      actual: ['512', '128', '256'].map(
        (size) => profilePhotoSizeSchema.safeParse(size).success,
      ),
      expected: [true, true, false],
    });
  });
});

describe('profilePhotoTransition', () => {
  test('total over status and event', () => {
    const events = ['approve', 'reject', 'remove', 'withdraw', 'erase'] as const;
    const table = Object.fromEntries(
      profilePhotoStatuses.map((status) => [
        status,
        events.map((event) => {
          const next = profilePhotoTransition(status, event);
          return next.kind === 'moved' ? next.to : next.kind;
        }),
      ]),
    );
    assert({
      given: 'every status and event',
      should: 'move along the lifecycle, repeat as unchanged, refuse the rest',
      actual: table,
      expected: {
        in_review: ['published', 'rejected', 'refused', 'withdrawn', 'erased'],
        published: ['unchanged', 'refused', 'removed', 'withdrawn', 'erased'],
        rejected: ['refused', 'unchanged', 'refused', 'unchanged', 'unchanged'],
        removed: ['refused', 'refused', 'unchanged', 'unchanged', 'unchanged'],
        withdrawn: ['refused', 'refused', 'refused', 'unchanged', 'unchanged'],
        erased: ['refused', 'refused', 'refused', 'unchanged', 'unchanged'],
      },
    });
  });
});
