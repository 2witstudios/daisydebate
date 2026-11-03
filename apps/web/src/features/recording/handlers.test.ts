import { noopErrorReporter } from '@daisy/observability';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Identity } from '@daisy/auth';
import { deps as fixture, record } from './fixture.test-support';
import { createRecordingHandlers } from './handlers';
import { silentLogger } from '../../server/test-loggers.test-support';

setupRitewayBun();

const origin = 'https://daisy.test';
const member = (actorId: string): Identity =>
  ({
    state: 'member',
    principal: { kind: 'user', userId: `u-${actorId}`, actorId },
  }) as Identity;
const anonymous = {
  state: 'anonymous',
  principal: { kind: 'anonymous' },
} as Identity;

const setup = (
  identity: Identity,
  over: { allowed?: boolean; subscribed?: boolean } = {},
) => {
  const d = fixture(record(), { subscribed: over.subscribed ?? true });
  return {
    d,
    handlers: createRecordingHandlers({
      logger: silentLogger,
      reporter: noopErrorReporter,
      origin: () => origin,
      identify: async () => identity,
      limiter: () => ({
        consume: async () => ({
          allowed: over.allowed ?? true,
          retryAfterSeconds: 60,
        }),
      }),
      clock: { now: () => '2026-11-02T12:00:00.000Z' } as never,
      store: d.store,
      objects: d.objects,
      inputs: {
        ...d.inputs,
        readFloorIntervals: async () => [],
        readCoverageFacts: async () => ({
          segments: [],
          prepStartsAtMs: [],
          rotationsAtMs: [],
        }),
      },
    }),
  };
};

const removal = (fields: string) =>
  new Request(`${origin}/api/recordings/rec/removal`, {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: fields,
  });
const roundId = 'a'.repeat(24);

describe('download', () => {
  const get = () => new Request(`${origin}/api/recordings/rec/download`);
  test('redirects a subscriber and refuses everyone else', async () => {
    const paid = await setup(member('x')).handlers.download(get(), 'rec');
    assert({
      given: 'a subscriber',
      should: 'redirect to a short-lived attachment, never cached',
      actual: [
        paid.status,
        paid.headers.get('location')?.includes('attachment='),
        paid.headers.get('cache-control'),
      ],
      expected: [302, true, 'no-store'],
    });
    assert({
      given: 'a member with no entitlement, a visitor and an exhausted budget',
      should: 'refuse on the server',
      actual: [
        (
          await setup(member('x'), { subscribed: false }).handlers.download(
            get(),
            'rec',
          )
        ).status,
        (await setup(anonymous).handlers.download(get(), 'rec')).status,
        (
          await setup(member('x'), { allowed: false }).handlers.download(
            get(),
            'rec',
          )
        ).status,
      ],
      expected: [404, 401, 429],
    });
  });
});

describe('removal', () => {
  test('a participant confirms, and returns to a fixed notice', async () => {
    const { d, handlers } = setup(member('aff'));
    const response = await handlers.removal(
      removal(`confirm=on&version=3&roundId=${roundId}`),
      'rec',
    );
    assert({
      given: 'a confirmed form',
      should: 'record the intent and answer with the notice',
      actual: [
        response.status,
        response.headers.get('location'),
        d.rows.get('rec')?.lifecycle.status,
      ],
      expected: [303, `/recordings/${roundId}?removal=requested`, 'removing'],
    });
  });

  test('every refusal leaves the Recording alone', async () => {
    const cases = [
      ['version=3', member('aff'), 'confirm'],
      ['confirm=on&version=2', member('aff'), 'changed'],
      ['confirm=on&version=3', member('stranger'), 'refused'],
      ['confirm=on&version=3', anonymous, 'refused'],
    ] as const;
    for (const [fields, identity, notice] of cases) {
      const { d, handlers } = setup(identity);
      const response = await handlers.removal(removal(fields), 'rec');
      assert({
        given: `the form ${fields}`,
        should: `answer ${notice} and keep it ready`,
        actual: [
          response.headers.get('location'),
          d.rows.get('rec')?.lifecycle.status,
        ],
        expected: [`/recordings?removal=${notice}`, 'ready'],
      });
    }
    const crossSite = await setup(member('aff')).handlers.removal(
      new Request(`${origin}/api/recordings/rec/removal`, {
        method: 'POST',
        headers: { origin: 'https://evil.test' },
        body: 'confirm=on&version=3',
      }),
      'rec',
    );
    assert({
      given: 'a post from another origin',
      should: 'refuse',
      actual: crossSite.status,
      expected: 403,
    });
  });
});

describe('playback', () => {
  test('answers playlists and redirects media', async () => {
    const { handlers } = setup(anonymous);
    const playlist = await handlers.playback(
      new Request(`${origin}/p`),
      'rec',
      ['master.m3u8'],
    );
    const segment = await handlers.playback(new Request(`${origin}/p`), 'rec', [
      '720p',
      'seg.ts',
    ]);
    assert({
      given: 'a visitor on a public Recording',
      should: 'serve the playlist and redirect the segment, neither cached',
      actual: [
        playlist.headers.get('content-type'),
        await playlist.text(),
        segment.status,
        segment.headers.get('cache-control'),
      ],
      expected: ['application/vnd.apple.mpegurl', '#EXTM3U', 302, 'no-store'],
    });
  });
});
