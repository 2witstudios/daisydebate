import { PROFILE_PHOTO_RENDITION_MAX_BYTES } from '@daisy/protocol/public-profile';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { authorize } from '@daisy/auth/authorization';
import type {
  ContentModerationChange,
  ContentModerationStore,
} from './content-moderation';
import type { ProfilePhotoObjects } from '../profile/photo/ports';
import { api, keyOf, signed, status } from './router.test-support';

setupRitewayBun();

const id = 't'.repeat(24);
const report = {
  reportId: 'r'.repeat(24),
  targetKind: 'round' as const,
  targetId: id,
  reason: 'spam' as const,
  status: 'open' as const,
  reportedAt: '2026-11-02T10:00:00.000Z',
  resolvedAt: null,
};
const fields = {
  v: 1,
  commandId: 'c'.repeat(24),
  adminAuditHead: 'a'.repeat(64),
};

const withStore = (
  overrides: Partial<ContentModerationStore> = {},
  profilePhotos: ProfilePhotoObjects | null = null,
) => {
  const changes: ContentModerationChange[] = [];
  const digests: string[] = [];
  const { handle } = api({
    profilePhotos,
    contentModeration: {
      listModerationReports: async () => [
        report,
        { ...report, reportId: 's'.repeat(24) },
      ],
      readModerationReport: async () => ({ report, subject: null }),
      listRebuildableRecordings: async () => [],
      listProfilePhotoReviews: async () => [],
      readOperatorProfilePhoto: async () => null,
      runModerationCommand: async (input) => {
        changes.push(input.change);
        digests.push(input.requestDigest);
        return { v: 1, outcome: 'applied' };
      },
      ...overrides,
    },
  });
  return { handle, changes, digests };
};
const put = (path: string, body: object) =>
  signed({ method: 'PUT', path, body: JSON.stringify({ ...fields, ...body }) });

describe('operator moderation (WATCH-7)', () => {
  test('a Recording command that names no version is refused', async () => {
    const { handle, changes } = withStore();
    const answers = await Promise.all(
      [
        put(`/operator/v1/recordings/${id}/takedown`, {
          reason: 'legal_request',
        }),
        put(`/operator/v1/recordings/${id}/restoration`, {}),
        put(`/operator/v1/recordings/${id}/removal`, {}),
        put(`/operator/v1/recordings/${id}/rebuild`, {}),
        put(`/operator/v1/recordings/${id}/legal-removal`, {
          reason: 'court_order',
        }),
        put(`/operator/v1/recordings/${id}/legal-removal`, {
          expectedVersion: 3,
        }),
        put(`/operator/v1/recordings/${id}/legal-removal`, {
          expectedVersion: 3,
          reason: 'because I said a name here',
        }),
      ].map(handle),
    );
    assert({
      given:
        'Recording commands without their version, or a legal removal without a closed reason',
      should: 'refuse each, and reach no store',
      actual: [answers.map((answer) => answer.status), changes],
      expected: [Array(7).fill(400), []],
    });
  });

  test('each command reaches the store as its own named change', async () => {
    const { handle, changes } = withStore();
    const answers = [
      await handle(
        put(`/operator/v1/broadcasts/${id}/stop`, { reason: 'technical' }),
      ),
      await handle(
        put(`/operator/v1/recordings/${id}/takedown`, {
          expectedVersion: 3,
          reason: 'legal_request',
        }),
      ),
      await handle(
        put(`/operator/v1/recordings/${id}/restoration`, {
          expectedVersion: 4,
        }),
      ),
      await handle(
        put(`/operator/v1/recordings/${id}/removal`, { expectedVersion: 5 }),
      ),
      await handle(
        put(`/operator/v1/recordings/${id}/legal-removal`, {
          expectedVersion: 6,
          reason: 'court_order',
        }),
      ),
      await handle(
        put(`/operator/v1/recordings/${id}/rebuild`, { expectedVersion: 7 }),
      ),
      await handle(put(`/operator/v1/chat-messages/${id}/removal`, {})),
      await handle(
        put(`/operator/v1/accounts/${id}/audience-ban`, { state: 'banned' }),
      ),
      await handle(
        put(`/operator/v1/broadcasts/${id}/chat-slow-mode`, { seconds: 30 }),
      ),
      await handle(
        put(`/operator/v1/content-reports/${id}/resolution`, {
          outcome: 'upheld',
        }),
      ),
    ];
    assert({
      given: 'a signed command of each kind',
      should: 'apply each with its target and its closed value',
      actual: [answers.map((answer) => answer.status), changes],
      expected: [
        Array(10).fill(200),
        [
          { action: 'broadcast.stop', broadcastId: id, reason: 'technical' },
          {
            action: 'recording.takedown',
            recordingId: id,
            expectedVersion: 3,
            reason: 'legal_request',
          },
          { action: 'recording.restore', recordingId: id, expectedVersion: 4 },
          { action: 'recording.remove', recordingId: id, expectedVersion: 5 },
          {
            action: 'recording.legal_remove',
            recordingId: id,
            expectedVersion: 6,
            reason: 'court_order',
          },
          { action: 'recording.rebuild', recordingId: id, expectedVersion: 7 },
          { action: 'chat_message.remove', messageId: id },
          {
            action: 'account.audience_ban.update',
            userId: id,
            state: 'banned',
          },
          {
            action: 'broadcast.chat_slow_mode.update',
            broadcastId: id,
            seconds: 30,
          },
          { action: 'content_report.resolve', reportId: id, outcome: 'upheld' },
        ],
      ],
    });
  });

  test('a retry under a new nonce is the same command', async () => {
    const { handle, digests } = withStore();
    const stop = () =>
      put(`/operator/v1/broadcasts/${id}/stop`, { reason: 'technical' });
    await handle(stop());
    await handle(stop());
    assert({
      given: 'the same stop sent twice',
      should: 'give the store one digest to replay against',
      actual: new Set(digests).size,
      expected: 1,
    });
  });

  test('a command it cannot read changes nothing', async () => {
    const { handle, changes } = withStore();
    const response = await handle(
      put(`/operator/v1/broadcasts/${id}/stop`, { reason: 'because' }),
    );
    assert({
      given: 'a reason outside the closed list',
      should: 'refuse and leave the store untouched',
      actual: [response.status, changes],
      expected: [400, []],
    });
  });

  test('an unsigned command never reaches the store', async () => {
    const { handle, changes } = withStore();
    const response = await handle(
      signed({
        method: 'PUT',
        path: `/operator/v1/broadcasts/${id}/stop`,
        body: JSON.stringify({ ...fields, reason: 'technical' }),
        key: keyOf(9),
      }),
    );
    assert({
      given: 'a signature from the wrong key',
      should: 'refuse as any authentication failure and change nothing',
      actual: [response.status, changes],
      expected: [401, []],
    });
  });

  test('the queue pages by keyset with its filter in the cursor', async () => {
    const { handle } = withStore();
    const response = await handle(
      signed({
        method: 'GET',
        path: '/operator/v1/content-reports',
        query: [
          ['queue', 'review'],
          ['status', 'open'],
          ['limit', '1'],
        ],
      }),
    );
    const page = (await response.json()) as {
      items: unknown[];
      nextCursor: string;
    };
    const stale = await handle(
      signed({
        method: 'GET',
        path: '/operator/v1/content-reports',
        query: [
          ['queue', 'safety'],
          ['status', 'open'],
          ['cursor', page.nextCursor],
        ],
      }),
    );
    assert({
      given:
        'one report with another behind it, then the cursor on another queue',
      should: 'answer a page, then refuse the mismatched cursor',
      actual: [page.items, stale.status],
      expected: [[report], 400],
    });
  });

  test('a report that is not there answers not found', async () => {
    const { handle } = withStore({ readModerationReport: async () => null });
    const response = await handle(
      signed({ method: 'GET', path: `/operator/v1/content-reports/${id}` }),
    );
    assert({
      given: 'an unknown report',
      should: 'answer 404',
      actual: await status(response),
      expected: [404, 'NOT_FOUND'],
    });
  });
});

const photoBytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3]);
const photoStore = (bytes: Uint8Array<ArrayBuffer> = photoBytes) => {
  const reads: [string, number][] = [];
  const objects: ProfilePhotoObjects = {
    put: async () => {
      throw new Error('Unexpected put');
    },
    read: async (key, maxBytes) => {
      reads.push([key, maxBytes]);
      return bytes;
    },
    removePrefix: async () => {
      throw new Error('Unexpected removal');
    },
  };
  return { objects, reads };
};
const livePhoto = async () => ({
  status: 'in_review' as const,
  version: 2,
  objectPrefix: `profile-photos/${id}`,
});

describe('operator profile moderation (ADR 0143)', () => {
  test('each profile command reaches the store as its own named change', async () => {
    const { handle, changes } = withStore();
    const answers = [
      await handle(
        put(`/operator/v1/profile-photos/${id}/review`, {
          expectedVersion: 2,
          outcome: 'approve',
        }),
      ),
      await handle(
        put(`/operator/v1/profile-photos/${id}/removal`, {
          expectedVersion: 3,
          reason: 'impersonation',
        }),
      ),
      await handle(
        put(`/operator/v1/profiles/${id}/text-removal`, {
          expectedVersion: 4,
          field: 'bio',
          reason: 'policy_violation',
        }),
      ),
    ];
    assert({
      given: 'a signed photo review, photo removal and text removal',
      should: 'apply each with its target, its version and its closed value',
      actual: [answers.map((answer) => answer.status), changes],
      expected: [
        [200, 200, 200],
        [
          {
            action: 'profile_photo.review',
            photoId: id,
            expectedVersion: 2,
            outcome: 'approve',
          },
          {
            action: 'profile_photo.remove',
            photoId: id,
            expectedVersion: 3,
            reason: 'impersonation',
          },
          {
            action: 'profile_text.remove',
            profileId: id,
            expectedVersion: 4,
            field: 'bio',
            reason: 'policy_violation',
          },
        ],
      ],
    });
  });

  test('a profile command it cannot read changes nothing', async () => {
    const { handle, changes } = withStore();
    const answers = await Promise.all(
      [
        put(`/operator/v1/profile-photos/${id}/review`, { outcome: 'approve' }),
        put(`/operator/v1/profile-photos/${id}/review`, {
          expectedVersion: 2,
          outcome: 'publish',
        }),
        put(`/operator/v1/profile-photos/${id}/removal`, {
          expectedVersion: 3,
          reason: 'I dislike it',
        }),
        put(`/operator/v1/profiles/${id}/text-removal`, {
          expectedVersion: 4,
          field: 'username',
          reason: 'policy_violation',
        }),
      ].map(handle),
    );
    assert({
      given:
        'a review without its version, an unknown outcome, an open reason and an unknown field',
      should: 'refuse each, and reach no store',
      actual: [answers.map((answer) => answer.status), changes],
      expected: [Array(4).fill(400), []],
    });
  });

  test('the in-review queue answers what the store holds', async () => {
    const item = {
      photoId: id,
      username: 'ada',
      checkVerdict: 'review' as const,
      uploadedAt: '2026-11-16T10:00:00.000Z',
      version: 1,
    };
    const { handle } = withStore({
      listProfilePhotoReviews: async () => [item],
    });
    const response = await handle(
      signed({ method: 'GET', path: '/operator/v1/profile-photos/in-review' }),
    );
    assert({
      given: 'one photo waiting for an operator',
      should: 'answer it',
      actual: [response.status, await response.json()],
      expected: [200, { items: [item] }],
    });
  });

  test('a photo read answers its 512px rendition, bounded', async () => {
    const { objects, reads } = photoStore();
    const { handle } = withStore(
      { readOperatorProfilePhoto: livePhoto },
      objects,
    );
    const response = await handle(
      signed({ method: 'GET', path: `/operator/v1/profile-photos/${id}` }),
    );
    assert({
      given: 'a live photo and a configured bucket',
      should: 'read its 512 rendition within a bound and answer it as base64',
      actual: [response.status, await response.json(), reads],
      expected: [
        200,
        {
          photoId: id,
          status: 'in_review',
          version: 2,
          imageWebpBase64: Buffer.from(photoBytes).toString('base64'),
        },
        [[`profile-photos/${id}/512.webp`, PROFILE_PHOTO_RENDITION_MAX_BYTES]],
      ],
    });
  });

  test('a photo read without a bucket, or of no photo, refuses', async () => {
    const unconfigured = withStore({ readOperatorProfilePhoto: livePhoto });
    const missing = withStore({}, photoStore().objects);
    const oversized = withStore(
      { readOperatorProfilePhoto: livePhoto },
      photoStore(new Uint8Array(PROFILE_PHOTO_RENDITION_MAX_BYTES + 1)).objects,
    );
    const read = () =>
      signed({ method: 'GET', path: `/operator/v1/profile-photos/${id}` });
    assert({
      given: 'no configured bucket, an ended photo, and an oversized object',
      should: 'answer unavailable, not found, and unavailable',
      actual: [
        await status(await unconfigured.handle(read())),
        await status(await missing.handle(read())),
        await status(await oversized.handle(read())),
      ],
      expected: [
        [503, 'INFRASTRUCTURE'],
        [404, 'NOT_FOUND'],
        [503, 'INFRASTRUCTURE'],
      ],
    });
  });
});

describe('who holds moderation capabilities', () => {
  test('only the operator service does', () => {
    const decide = (principal: Parameters<typeof authorize>[0]['principal']) =>
      authorize({
        principal,
        capability: 'broadcast.stop',
        resource: { kind: 'content_moderation' },
        context: { account: null },
      }).allow;
    const operator = (
      capabilities: readonly ('broadcast.stop' | 'content_report.resolve')[],
    ) =>
      ({
        kind: 'operator_service',
        serviceId: 'daisy-admin',
        keyId: 'k1',
        operatorRef: 'o',
        capabilities,
      }) as const;
    assert({
      given: 'the service holding it, the service without it, and anonymous',
      should: 'allow only the first',
      actual: [
        decide(operator(['broadcast.stop'])),
        decide(operator(['content_report.resolve'])),
        decide({ kind: 'anonymous' }),
      ],
      expected: [true, false, false],
    });
  });
});
