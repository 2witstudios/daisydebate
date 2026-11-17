import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import type { PhotoCheckVerdict } from '@daisy/protocol/public-profile';
import { intakeProfilePhoto, type PhotoIntakeDependencies } from './intake';

setupRitewayBun();

const principal = {
  kind: 'user',
  userId: 'u'.repeat(24),
  actorId: 'a'.repeat(24),
} as const;
const photoId = 'p'.repeat(24);
const jpeg = { mime: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]) };

/** A fake intake: records what it stored, recorded and deleted. */
function harness(
  overrides: Partial<PhotoIntakeDependencies> & {
    readonly verdict?: PhotoCheckVerdict | 'throws' | 'none';
    readonly scan?: 'clean' | 'infected' | 'throws';
    readonly failPut?: boolean;
  } = {},
) {
  const stored: string[] = [];
  const removed: string[] = [];
  const recorded: unknown[] = [];
  const reserved: unknown[] = [];
  const verdict = overrides.verdict ?? 'allow';
  const dependencies: PhotoIntakeDependencies = {
    clock: { now: () => '2026-11-16T00:00:00.000Z' },
    ids: { next: () => photoId },
    storage: {
      objects: {
        put: async (key) => {
          if (overrides.failPut) throw new Error('storage down');
          stored.push(key);
        },
        read: async () => new Uint8Array(),
        removePrefix: async (prefix) => {
          removed.push(prefix);
        },
      },
      scanner: {
        scan: async () => {
          if (overrides.scan === 'throws') throw new Error('clamd down');
          return overrides.scan ?? 'clean';
        },
      },
    },
    classifier:
      verdict === 'none'
        ? null
        : {
            check: async () => {
              if (verdict === 'throws') throw new Error('vendor down');
              return verdict;
            },
          },
    renditions: async (_bytes, _mime, sizes) =>
      sizes.map((size) => ({ size, bytes: new Uint8Array([size % 256]) })),
    reserve: async (_scope, input) => {
      reserved.push(input);
    },
    record: async (_scope, input) => {
      recorded.push(input);
      return {
        profileId: null,
        displayName: null,
        bio: null,
        published: input.status === 'published' ? input.photoId : null,
        inReview: input.status === 'in_review' ? input.photoId : null,
      };
    },
    ...overrides,
  };
  return { dependencies, stored, removed, recorded, reserved };
}

test('an allowed photo is stored and published', async () => {
  const run = harness();
  const result = await intakeProfilePhoto(principal, jpeg, run.dependencies);
  assert({
    given: 'a clean JPEG the check allows',
    should:
      'reserve the row owing its deletion, then store both renditions, then publish it',
    actual: {
      status: result.status,
      reserved: run.reserved,
      stored: run.stored,
      recorded: run.recorded,
      removed: run.removed,
    },
    expected: {
      status: 'published',
      reserved: [
        {
          photoId,
          objectPrefix: `profile-photos/${photoId}`,
          checkVerdict: 'allow',
          now: '2026-11-16T00:00:00.000Z',
          deleteAfter: '2026-11-16T01:00:00.000Z',
        },
      ],
      stored: [
        `profile-photos/${photoId}/512.webp`,
        `profile-photos/${photoId}/128.webp`,
      ],
      recorded: [
        { photoId, status: 'published', now: '2026-11-16T00:00:00.000Z' },
      ],
      removed: [],
    },
  });
});

test('an unsure, failed or absent check sends the photo to review', async () => {
  const statuses = [];
  for (const verdict of ['review', 'throws', 'none'] as const) {
    const run = harness({ verdict });
    statuses.push([
      verdict,
      (await intakeProfilePhoto(principal, jpeg, run.dependencies)).status,
    ]);
  }
  assert({
    given: 'a review verdict, a check that throws and no check configured',
    should: 'store each photo in review, never published',
    actual: statuses,
    expected: [
      ['review', 'in_review'],
      ['throws', 'in_review'],
      ['none', 'in_review'],
    ],
  });
});

test('refused uploads store nothing', async () => {
  const cases = [
    {
      given: 'no storage configured',
      run: harness({ storage: null }),
      upload: jpeg,
      reason: 'photo-unavailable',
    },
    {
      given: 'an SVG',
      run: harness(),
      upload: { mime: 'image/svg+xml', bytes: new Uint8Array([1]) },
      reason: 'photo-type-unsupported',
    },
    {
      given: 'a file over the upload bound',
      run: harness(),
      upload: { mime: 'image/png', bytes: new Uint8Array(5 * 1024 * 1024 + 1) },
      reason: 'photo-too-large',
    },
    {
      given: 'a file the scanner finds infected',
      run: harness({ scan: 'infected' }),
      upload: jpeg,
      reason: 'photo-malware',
    },
    {
      given: 'a scanner that cannot answer',
      run: harness({ scan: 'throws' }),
      upload: jpeg,
      reason: 'photo-unavailable',
    },
    {
      given: 'bytes that do not decode',
      run: harness({
        renditions: async () => {
          throw createAppError('VALIDATION');
        },
      }),
      upload: jpeg,
      reason: 'photo-unreadable',
    },
    {
      given: 'a photo the check blocks',
      run: harness({ verdict: 'block' }),
      upload: jpeg,
      reason: 'photo-blocked',
    },
  ];
  for (const { given, run, upload, reason } of cases) {
    const refused = await intakeProfilePhoto(
      principal,
      upload,
      run.dependencies,
    ).then(
      () => null,
      (error: { reason?: string }) => error.reason ?? null,
    );
    assert({
      given,
      should: `refuse with ${reason}, reserving, storing and recording nothing`,
      actual: {
        refused,
        reserved: run.reserved,
        stored: run.stored,
        recorded: run.recorded,
      },
      expected: { refused: reason, reserved: [], stored: [], recorded: [] },
    });
  }
});

test('a storage failure leaves the cleanup to the reservation', async () => {
  const run = harness({ failPut: true });
  await assertRejects({
    given: 'storage that refuses the write',
    should: 'refuse as unavailable',
    actual: () => intakeProfilePhoto(principal, jpeg, run.dependencies),
    code: 'INFRASTRUCTURE',
  });
  assert({
    given: 'the refused write',
    should:
      'record nothing and delete nothing here: the reserved row owes the deletion, which the sweep pays',
    actual: {
      reserved: run.reserved.length,
      removed: run.removed,
      recorded: run.recorded,
    },
    expected: { reserved: 1, removed: [], recorded: [] },
  });
});
