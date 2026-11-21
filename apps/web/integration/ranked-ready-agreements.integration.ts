import { daisyOrganizationId, publicLobbyId } from '@daisy/db/testing';
import { requireTestServices } from '@daisy/config';
import { isAppError } from '@daisy/errors';
import { createId } from '@paralleldrive/cuid2';
import { isNamedSeat } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  agreementWords,
  contentWaiverDocument,
  casualCaptureNotice,
  CONTENT_WAIVER_VERSION,
  youthContentWaiverDocument,
  YOUTH_CONTENT_WAIVER_VERSION,
} from '../src/features/legal/agreements';
import { withRoomRuntime } from './room-runtime.test-support';
import { setAge, withYouthSeason } from './youth-round.test-support';
import { readyRankedRoom } from './ranked-room.test-support';

setupRitewayBun();
requireTestServices(process.env);

type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];

const rankedRoom = async (f: Fixture) => {
  const [preset] =
    await f.sql`select format_version,version from format_presets where format_id='freestyle' and superseded_at is null`;
  const created = await f.create({
    resolution: { kind: 'strike' },
    selection: {
      kind: 'ranked',
      formatId: 'freestyle',
      formatVersion: preset!.format_version,
      presetVersion: preset!.version,
    },
    cast: [
      {
        actorId: f.host.actorId,
        seat: { kind: 'side', side: 'affirmative', slot: 0 },
      },
    ],
  });
  return created.view;
};

const withSeason = async (f: Fixture, run: () => Promise<void>) => {
  const seasonId = createId();
  await f.sql`insert into seasons(organization_id,id,lobby_id,name,starts_at,status) values(${daisyOrganizationId},${seasonId},${publicLobbyId},'Waiver fixture','2000-01-01T00:00:00Z','active')`;
  f.afterRooms(async () => {
    await f.sql`delete from agreement_signatures where season_id=${seasonId}`;
    await f.sql`delete from seasons where id=${seasonId}`;
  });
  await run();
};

const refusalOf = (attempt: Promise<unknown>) =>
  attempt.then(
    () => 'accepted',
    (error: unknown) => (isAppError(error) ? error.message : 'threw'),
  );

test('a Ready from an earlier season does not carry its waiver into Start', async () => {
  await withRoomRuntime(async (f) =>
    withSeason(f, async () => {
      const ready = await readyRankedRoom(f, 'freestyle', 'human');
      const nextSeason = createId();
      await f.sql.begin(async (tx) => {
        await tx`update seasons set status='closed', ends_at=now() where lobby_id=${publicLobbyId} and status='active'`;
        await tx`insert into seasons (id, lobby_id, organization_id, name, status, starts_at)
        values (${nextSeason},${publicLobbyId},${daisyOrganizationId},'New waiver season','active',now())`;
      });
      f.afterRooms(async () => {
        await f.sql`delete from agreement_signatures where season_id=${nextSeason}`;
        await f.sql`delete from seasons where id=${nextSeason}`;
      });
      const refused = await refusalOf(
        f.command(f.host, ready, { type: 'start-round' }),
      );
      for (const person of [f.host, f.guest, f.outsider])
        await f.store.signContentWaiver({
          id: createId(),
          roomId: ready.id,
          userId: person.userId,
          version: CONTENT_WAIVER_VERSION,
          words: agreementWords(contentWaiverDocument),
        });
      await f.command(f.host, ready, { type: 'start-round' });
      const [started] =
        await f.sql`select season_id from rounds where room_id=${ready.id}`;
      assert({
        given:
          'three Ready seats followed by a season rollover and signed replacement waivers',
        should:
          'refuse the first Start and freeze the replacement season once all waivers stand',
        actual: [refused, started?.season_id],
        expected: ['content-waiver-required', nextSeason],
      });
    }),
  );
});

test('Ready on a ranked Round waits for the signed waiver alone, and records no notice', async () => {
  await withRoomRuntime(async (f) =>
    withSeason(f, async () => {
      const room = await rankedRoom(f);
      const standing = await f.operations.view(f.host, room.id);
      const unsigned = await refusalOf(f.consent(f.host, standing, 'ready'));
      const refusedRows =
        await f.sql`select count(*)::int as c from agreement_signatures where user_id=${f.host.userId}`;
      await f.store.signContentWaiver({
        roomId: room.id,
        id: createId(),
        userId: f.host.userId,
        version: CONTENT_WAIVER_VERSION,
        words: agreementWords(contentWaiverDocument),
      });
      const signed = await f.operations.view(f.host, room.id);
      const claimed = await refusalOf(
        f.command(f.host, signed, {
          type: 'ready',
          noticeVersion: casualCaptureNotice.version,
          expectedConsentVersion: signed.participants
            .filter(isNamedSeat)
            .find((p) => p.actorId === f.host.actorId)!.consentVersion,
        }),
      );
      const ready = await f.consent(f.host, signed, 'ready');
      const notices =
        await f.sql`select version, room_id from agreement_signatures where user_id=${f.host.userId} and agreement='round-capture-notice'`;
      assert({
        given:
          'an unsigned member, then a signed one whose Ready claims a notice, then states none',
        should:
          'refuse Ready until signed, show no notice, refuse the claimed one, then accept with no notice recorded',
        actual: {
          standing: standing.contentWaiver,
          unsigned,
          refusedRows: refusedRows[0]!.c,
          signed: signed.contentWaiver,
          shown: signed.captureNotice,
          claimed,
          isReady: ready.view.participants
            .filter(isNamedSeat)
            .find((p) => p.actorId === f.host.actorId)!.ready,
          notices: [...notices],
        },
        expected: {
          standing: 'unsigned',
          unsigned: 'content-waiver-required',
          refusedRows: 0,
          signed: 'signed',
          shown: null,
          claimed: 'capture-notice-changed',
          isReady: 'ready',
          notices: [],
        },
      });
    }),
  );
});

test('a casual Round asks for neither', async () => {
  await withRoomRuntime(async (f) => {
    const room = await f.assemble();
    const view = await f.operations.view(f.host, room.id);
    const rows =
      await f.sql`select count(*)::int as c from agreement_signatures where user_id=${f.host.userId}`;
    assert({
      given: 'a casual Ready from a member who never signed',
      should: 'accept it and record nothing',
      actual: [
        view.contentWaiver,
        view.captureNotice,
        rows[0]!.c,
        view.participants.filter(isNamedSeat).every((p) => p.ready === 'ready'),
      ],
      expected: [null, null, 0, true],
    });
  });
});

test('an unsigned human judge cannot Ready a ranked Round until they sign', async () => {
  await withRoomRuntime(async (f) =>
    withSeason(f, async () => {
      const room = await rankedRoom(f);
      const seated = (
        await f.command(f.outsider, room, {
          type: 'claim-seat',
          seat: { kind: 'judge', slot: 0 },
        })
      ).view;
      const unsigned = await refusalOf(f.consent(f.outsider, seated, 'ready'));
      await f.store.signContentWaiver({
        roomId: room.id,
        id: createId(),
        userId: f.outsider.userId,
        version: CONTENT_WAIVER_VERSION,
        words: agreementWords(contentWaiverDocument),
      });
      const signed = await f.operations.view(f.outsider, room.id);
      const ready = await f.consent(f.outsider, signed, 'ready');
      assert({
        given: 'a judge seat held by a member who never signed, then signs',
        should: 'refuse Ready on the server, then accept it',
        actual: [
          unsigned,
          ready.view.participants
            .filter(isNamedSeat)
            .find((p) => p.actorId === f.outsider.actorId)!.ready,
        ],
        expected: ['content-waiver-required', 'ready'],
      });
    }),
  );
});

test('a member under 18 judging an Open ranked Room signs the Youth waiver, not the Open one (ADR 0161)', async () => {
  await withRoomRuntime(async (f) =>
    withYouthSeason(f, async () => {
      await setAge(f, f.outsider, '16 years');
      const room = await rankedRoom(f);
      const seated = (
        await f.command(f.outsider, room, {
          type: 'claim-seat',
          seat: { kind: 'judge', slot: 0 },
        })
      ).view;
      const asked = await f.operations.view(f.outsider, room.id);
      // The Open waiver, with its licence, never stands in for a minor's.
      await f.store.signContentWaiver({
        roomId: room.id,
        id: createId(),
        userId: f.outsider.userId,
        version: CONTENT_WAIVER_VERSION,
        words: agreementWords(contentWaiverDocument),
      });
      const openOnly = await refusalOf(f.consent(f.outsider, seated, 'ready'));
      await f.store.signContentWaiver({
        roomId: room.id,
        id: createId(),
        userId: f.outsider.userId,
        version: YOUTH_CONTENT_WAIVER_VERSION,
        words: agreementWords(youthContentWaiverDocument),
      });
      const signed = await f.operations.view(f.outsider, room.id);
      const ready = await f.consent(f.outsider, signed, 'ready');
      const hostAsked = await f.operations.view(f.host, room.id);
      assert({
        given:
          'a 16-year-old judging an Open ranked Room, signing the Open waiver, then the Youth one, beside an adult debater',
        should:
          'ask the judge for the Youth waiver, refuse Ready on the Open one alone, accept it on the Youth one, and ask the adult for the Open waiver',
        actual: {
          asked: [asked.contentWaiver, asked.contentWaiverVersion],
          openOnly,
          ready: ready.view.participants
            .filter(isNamedSeat)
            .find((p) => p.actorId === f.outsider.actorId)!.ready,
          host: hostAsked.contentWaiverVersion,
        },
        expected: {
          asked: ['unsigned', YOUTH_CONTENT_WAIVER_VERSION],
          openOnly: 'content-waiver-required',
          ready: 'ready',
          host: CONTENT_WAIVER_VERSION,
        },
      });
    }),
  );
});

test('a signature keeps the exact words, whatever the source says later', async () => {
  await withRoomRuntime(async (f) =>
    withSeason(f, async () => {
      const room = await rankedRoom(f);
      await f.store.signContentWaiver({
        roomId: room.id,
        id: createId(),
        userId: f.host.userId,
        version: CONTENT_WAIVER_VERSION,
        words: agreementWords(contentWaiverDocument),
      });
      const view = await f.operations.view(f.host, room.id);
      await f.consent(f.host, view, 'ready');
      const rows =
        await f.sql`select agreement, words from agreement_signatures where user_id=${f.host.userId} order by agreement`;
      assert({
        given: 'a signed waiver and a Ready on a ranked Round',
        should: 'store the waiver with its words, and nothing else',
        actual: [...rows],
        expected: [
          {
            agreement: 'ranked-content-waiver',
            words: agreementWords(contentWaiverDocument),
          },
        ],
      });
    }),
  );
});

test('a ranked create needs no notice and records none', async () => {
  await withRoomRuntime(async (f) =>
    withSeason(f, async () => {
      const [preset] =
        await f.sql`select format_version,version from format_presets where format_id='freestyle' and superseded_at is null`;
      const selection = {
        kind: 'ranked' as const,
        formatId: 'freestyle',
        formatVersion: preset!.format_version,
        presetVersion: preset!.version,
      };
      const notices = (userId: string) =>
        f.sql`select version from agreement_signatures where user_id=${userId} and agreement='round-capture-notice'`;
      const created = await f.create({ selection });
      const claimed = await refusalOf(
        f.create(
          { selection, noticeVersion: casualCaptureNotice.version },
          f.guest,
        ),
      );
      const challenge = await f.create(
        { selection, holdSeatsFor: [f.outsider.actorId] },
        f.outsider,
      );
      assert({
        given:
          'a seatless ranked host stating no notice, a create claiming a notice, and a host holding a seat',
        should:
          'create the first and the last with no notice shown or recorded, and refuse the claim with nothing kept',
        actual: {
          created: [created.view.competitionType, created.view.captureNotice],
          seated: created.view.participants
            .filter(isNamedSeat)
            .some((p) => p.actorId === f.host.actorId),
          claimed,
          challenge: [
            challenge.view.competitionType,
            challenge.view.captureNotice,
          ],
          recorded: (
            await Promise.all(
              [f.host, f.guest, f.outsider].map((member) =>
                notices(member.userId),
              ),
            )
          ).map((rows) => rows.length),
        },
        expected: {
          created: ['ranked', null],
          seated: false,
          claimed: 'capture-notice-changed',
          challenge: ['ranked', null],
          recorded: [0, 0, 0],
        },
      });
    }),
  );
});
