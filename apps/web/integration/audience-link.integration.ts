import { requireTestServices } from '@daisy/config';
import {
  oneOnOneDefinition,
  oneOnOneSettings,
} from '@daisy/db/reference-formats';
import { noopErrorReporter } from '@daisy/observability';
import { spectatorTimelineSchema } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { audienceLinkHash } from '../src/features/audience-link/audience-link';
import { createAudienceLinkHandlers } from '../src/features/audience-link/handlers';
import { createSpectatorTimelineHandlers } from '../src/features/spectating/handlers';
import { silentLogger } from '../src/server/test-loggers.test-support';
import { launchRuntimeRound } from './round-runtime.test-support';
import { withRoomRuntime } from './room-runtime.test-support';

setupRitewayBun();
requireTestServices(process.env);

const origin = 'http://localhost';
const now = () => new Date().toISOString();
const limiter = {
  consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
} as never;

test('an unlisted Round, by its link, on real Postgres', async () => {
  await withRoomRuntime(async (f) => {
    const room = await f.assemble({
      visibility: 'unlisted',
      selection: {
        kind: 'custom',
        definition: {
          ...oneOnOneDefinition,
          seats: { affirmative: 1, negative: 1, judge: 0 },
        },
        competitionType: 'casual',
        config: oneOnOneSettings,
      },
    });
    const { roundId } = await launchRuntimeRound(f, room);
    const store = f.store as never as Parameters<
      typeof createAudienceLinkHandlers
    >[0]['store'] &
      Parameters<typeof createSpectatorTimelineHandlers>[0]['store'];
    const broadcasts = (
      f.store as never as {
        broadcasts: {
          open: (input: {
            id: string;
            roundId: string;
            feedKey: string;
            releasePolicy: { kind: 'delay'; seconds: number };
          }) => Promise<{ id: string; feedKey: string }>;
        };
      }
    ).broadcasts;
    const policy = { kind: 'delay', seconds: 60 } as const;
    const opened = await broadcasts.open({
      id: createId(),
      roundId,
      feedKey: 'first-random-key',
      releasePolicy: policy,
    });
    const reopened = await broadcasts.open({
      id: createId(),
      roundId,
      feedKey: 'second-random-key',
      releasePolicy: policy,
    });
    await f.sql`update broadcasts set released_through_at=now() where id=${opened.id}`;
    try {
      assert({
        given: 'a Broadcast opened twice',
        should: 'keep the key it was opened with',
        actual: reopened.feedKey,
        expected: 'first-random-key',
      });

      const asMember = (caller: { userId: string; actorId: string }) =>
        createAudienceLinkHandlers({
          logger: silentLogger,
          reporter: noopErrorReporter,
          origin: () => origin,
          identify: async () =>
            ({
              state: 'member',
              principal: { kind: 'user', ...caller },
            }) as never,
          limiter: () => limiter,
          store,
        });
      const issue = (caller: { userId: string; actorId: string }) =>
        asMember(caller).issue(
          new Request(`${origin}/api/rounds/${roundId}/audience-link`, {
            method: 'POST',
            headers: { origin },
          }),
          roundId,
        );
      const route = createSpectatorTimelineHandlers({
        logger: silentLogger,
        reporter: noopErrorReporter,
        clock: { now },
        store,
        feedUrlOf: (key) => `https://feed.example/live/${key}/master.m3u8`,
      });
      const read = (cookie: string | null, id = roundId) =>
        route.GET(
          new Request(`${origin}/api/rounds/${id}/timeline`, {
            headers: cookie ? { cookie } : {},
          }),
          id,
        );
      const answer = async (response: Response) => [
        response.status,
        await response.text(),
        response.headers.get('Cache-Control'),
      ];
      const cookieOf = async (href: string) =>
        (
          await asMember(f.outsider).open(
            new Request(`${origin}${href}`),
            roundId,
          )
        ).headers
          .get('set-cookie')!
          .split(';')[0]!;
      const stored = async () =>
        (
          (await f.sql`select audience_link_hash as hash, to_jsonb(r)::text as whole from rounds r where id=${roundId}`) as {
            hash: string | null;
            whole: string;
          }[]
        )[0]!;

      const missing = await answer(await read(null, createId()));
      assert({
        given: 'an unlisted Round with no link at all',
        should: 'answer exactly as a missing Round',
        actual: await answer(await read(null)),
        expected: missing,
      });

      const refused = await issue(f.outsider);
      assert({
        given: 'a member who does not host the Room',
        should: 'be refused, and store nothing',
        actual: [refused.status, (await stored()).hash],
        expected: [404, null],
      });

      const { href: firstHref } = (await (await issue(f.host)).json()) as {
        href: string;
      };
      const token = new URL(firstHref, origin).searchParams.get('token')!;
      const row = await stored();
      assert({
        given: 'the host issuing a link',
        should:
          'store only its SHA3-256 hash, and the token nowhere on the row',
        actual: [row.hash, row.whole.includes(token)],
        expected: [audienceLinkHash(token), false],
      });

      const firstCookie = await cookieOf(firstHref);
      const admitted = await read(firstCookie);
      const timeline = spectatorTimelineSchema.parse(
        await admitted.clone().json(),
      );
      assert({
        given: 'the browser holding the current link',
        should:
          'read the timeline uncached, with the feed under its random key',
        actual: [
          admitted.status,
          admitted.headers.get('Cache-Control'),
          timeline.broadcast.state,
          'stream' in timeline.broadcast
            ? timeline.broadcast.stream?.manifestUrl
            : null,
        ],
        expected: [
          200,
          'no-store',
          'on_air',
          'https://feed.example/live/first-random-key/master.m3u8',
        ],
      });
      assert({
        given: 'the snapshot just read for the holder, and a reader without it',
        should: 'answer that reader exactly as a missing Round',
        actual: await answer(await read(null)),
        expected: missing,
      });
      assert({
        given: 'a wrong link',
        should: 'answer exactly as a missing Round',
        actual: await answer(
          await read(`daisy_audience_link_${roundId}=${'Z'.repeat(43)}`),
        ),
        expected: missing,
      });

      const { href: secondHref } = (await (await issue(f.host)).json()) as {
        href: string;
      };
      assert({
        given: 'the link replaced, within the snapshot memo’s interval',
        should: 'refuse the old link at once and admit the new one',
        actual: [
          await answer(await read(firstCookie)),
          (await read(await cookieOf(secondHref))).status,
        ],
        expected: [missing, 200],
      });
    } finally {
      await f.sql`delete from broadcasts where round_id=${roundId}`;
    }
  });
});

test('a public Round has no link to issue', async () => {
  await withRoomRuntime(async (f) => {
    const room = await f.assemble({
      visibility: 'public',
      selection: {
        kind: 'custom',
        definition: {
          ...oneOnOneDefinition,
          seats: { affirmative: 1, negative: 1, judge: 0 },
        },
        competitionType: 'casual',
        config: oneOnOneSettings,
      },
    });
    const { roundId } = await launchRuntimeRound(f, room);
    const store = f.store as never as {
      setRoundAudienceLink: (input: {
        roundId: string;
        hash: string;
      }) => Promise<boolean>;
    };
    assert({
      given: 'the store asked to write a hash on a public Round',
      should: 'refuse in the statement itself',
      actual: await store.setRoundAudienceLink({ roundId, hash: 'h' }),
      expected: false,
    });
  });
});
