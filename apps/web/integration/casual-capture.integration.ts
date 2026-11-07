import { requireTestServices } from '@daisy/config';
import { isNamedSeat } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundCaptureNotice } from '../src/features/legal/agreements';
import { withRoomRuntime } from './room-runtime.test-support';
import { assembleJudgedRoom } from './round-judging.test-support';

requireTestServices(process.env);
setupRitewayBun();

const casualValue = {
  kind: 'catalog' as const,
  formatId: 'value',
  formatVersion: 1,
  presetVersion: 1,
  competitionType: 'casual' as const,
};
const both = {
  broadcast: {
    release: { kind: 'delay' as const, seconds: 60 },
    debatersReadChat: false,
  },
  recording: true,
};

test('a beta host’s capture choice is stored and every seat is told before Ready', async () => {
  await withRoomRuntime(async (f) => {
    const open = await f.create({ selection: casualValue });
    const chosen = await f.command(f.host, open.view, {
      type: 'set-capture',
      capture: both,
    });
    const reread = await f.operations.view(f.host, open.view.id);
    assert({
      given: 'a host holding the grant beta approval wrote',
      should:
        'store the choice, say it to the Room, and owe the opted-in notice',
      actual: [
        open.view.captureOffer,
        chosen.view.capture,
        reread.capture,
        reread.captureNotice,
      ],
      expected: ['included', both, both, roundCaptureNotice('opted-in')],
    });
  });
});

test('a host without the grant is offered neither, is refused, and captures nothing', async () => {
  await withRoomRuntime(async (f) => {
    const host = await f.member();
    await f.sql`delete from account_entitlement_grants where user_id=${host.userId} and entitlement='casual_capture'`;
    const open = await f.create({ selection: casualValue }, host);
    const before = await f.snapshot(open.view.id);
    const refusal = await f.operations
      .command(host, open.view.id, {
        type: 'set-capture',
        commandId: createId(),
        expectedVersion: open.view.version,
        capture: both,
      })
      .catch((error: { reason?: string }) => error.reason);
    const view = await f.operations.view(host, open.view.id);
    assert({
      given: 'a forged post from a host with no grant',
      should: 'refuse, leave the Room unchanged, offer premium, show no notice',
      actual: [
        refusal,
        await f.snapshot(open.view.id),
        view.captureOffer,
        view.capture,
        view.captureNotice,
      ],
      expected: ['capture-premium', before, 'premium', null, null],
    });
  });
});

test('the casual AI judge grant does not speak for capture', async () => {
  await withRoomRuntime(async (f) => {
    const host = await f.member();
    await f.sql`delete from account_entitlement_grants where user_id=${host.userId} and entitlement='casual_capture'`;
    const open = await f.create({ selection: casualValue }, host);
    const [held] =
      await f.sql`select count(*)::int as c from account_entitlement_grants where user_id=${host.userId} and entitlement='casual_ai_judge'`;
    assert({
      given: 'a host holding the AI judge grant and not the capture grant',
      should: 'still show premium for capture',
      actual: [held.c, open.view.captureOffer],
      expected: [1, 'premium'],
    });
  });
});

test('Launch freezes the choice on the Round, and refuses a host who lost the grant', async () => {
  await withRoomRuntime(async (f) => {
    const { actorId: judgeId } = await f.aiJudge();
    let view = await assembleJudgedRoom(f);
    view = (
      await f.command(f.host, view, {
        type: 'assign-seat',
        actorId: judgeId,
        role: 'judge',
        slot: 0,
      })
    ).view;
    view = (
      await f.command(f.host, view, { type: 'set-capture', capture: both })
    ).view;
    for (const c of [f.host, f.guest])
      view = (await f.consent(c, view, 'ready')).view;
    await f.sql`delete from account_entitlement_grants where user_id=${f.host.userId} and entitlement='casual_capture'`;
    const refused = await f.operations
      .command(f.host, view.id, {
        type: 'start-round',
        commandId: createId(),
        expectedVersion: view.version,
      })
      .catch((error: { reason?: string }) => error.reason);
    await f.sql`insert into account_entitlement_grants (user_id, entitlement, source) values (${f.host.userId}, 'casual_capture', 'beta')`;
    const launched = await f.command(f.host, view, { type: 'start-round' });
    const [round] =
      await f.sql`select capture from rounds where id=${launched.view.roundRef!.id}`;
    assert({
      given: 'a Launch after the grant went, then one with it back',
      should: 'refuse the first, and freeze exactly what seats were told',
      actual: [refused, round.capture],
      expected: ['capture-premium', both],
    });
  });
});

test('a ready that read no notice is refused once the host opts in', async () => {
  await withRoomRuntime(async (f) => {
    const open = await f.create({ selection: casualValue });
    const claimed = await f.command(f.host, open.view, {
      type: 'claim-seat',
      role: 'affirmative',
      slot: 0,
    });
    const chosen = await f.command(f.host, claimed.view, {
      type: 'set-capture',
      capture: { broadcast: null, recording: true },
    });
    const refusal = await f.operations
      .command(f.host, chosen.view.id, {
        type: 'ready',
        commandId: createId(),
        expectedVersion: chosen.view.version,
        expectedConsentVersion: chosen.view.participants
          .filter(isNamedSeat)
          .find((p) => p.actorId === f.host.actorId)!.consentVersion,
      })
      .catch((error: { reason?: string }) => error.reason);
    assert({
      given: 'a stale Ready form with no notice on it',
      should: 'refuse rather than record words it never showed',
      actual: refusal,
      expected: 'capture-notice-changed',
    });
  });
});

test('creation saves recording atomically, replays it, and refuses a host without the capture grant', async () => {
  await withRoomRuntime(async (f) => {
    const notice = roundCaptureNotice('opted-in')!;
    const commandId = createId();
    const open = await f.create({
      commandId,
      recording: true,
      noticeVersion: notice.version,
      selection: casualValue,
    });
    const before = await f.snapshot(open.view.id);
    const replay = await f.create({
      commandId,
      recording: true,
      noticeVersion: notice.version,
      selection: casualValue,
    });
    const reread = await f.operations.view(f.host, open.view.id);
    assert({
      given:
        'a recording requested during creation, then the same create retried',
      should:
        'persist one recording-only choice with the opted-in notice and replay without mutation',
      actual: [
        open.view.capture,
        reread.capture,
        reread.captureNotice,
        replay.receipt.replayed,
        await f.snapshot(open.view.id),
      ],
      expected: [
        { broadcast: null, recording: true },
        { broadcast: null, recording: true },
        roundCaptureNotice('opted-in'),
        true,
        before,
      ],
    });
    const stated =
      await f.sql`select version,words from agreement_signatures where room_id=${open.view.id}`;
    assert({
      given: 'the exact casual notice carried by creation',
      should: 'persist its version and words once across replay',
      actual: stated,
      expected: [{ version: notice.version, words: notice.text }],
    });
    const unshownHost = await f.member();
    const unshown = await f.create(
      { recording: true, selection: casualValue },
      unshownHost,
    );
    const unshownNotices =
      await f.sql`select version from agreement_signatures where room_id=${unshown.view.id}`;
    assert({
      given: 'a casual recording create stating no notice',
      should: 'create without recording unseen notice words',
      actual: [unshown.view.capture, unshownNotices],
      expected: [{ broadcast: null, recording: true }, []],
    });
    const host = await f.member();
    const bot = await f.bot();
    await f.sql`delete from account_entitlement_grants where user_id=${host.userId} and entitlement='casual_capture'`;
    const refusal = await f
      .create(
        {
          recording: true,
          noticeVersion: notice.version,
          selection: casualValue,
          cast: [{ actorId: bot.actorId, role: 'negative', slot: 0 }],
        },
        host,
      )
      .then(
        () => 'created',
        (error: { reason?: string }) => error.reason,
      );
    const seats =
      await f.sql`select id from room_participants where actor_id=${bot.actorId}`;
    const notices =
      await f.sql`select id from agreement_signatures where user_id=${host.userId}`;
    const [rooms] =
      await f.sql`select count(*)::int as count from rooms where host_actor_id=${host.actorId}`;
    assert({
      given: 'a recording create from a host without the grant',
      should: 'refuse atomically without leaving a room or active membership',
      actual: [
        refusal,
        rooms.count,
        seats,
        notices,
        await f.operations.activeRoom(host),
      ],
      expected: ['capture-premium', 0, [], [], null],
    });
    const plain = await f.create({ selection: casualValue }, host);
    assert({
      given: 'the same host creating without recording',
      should: 'still create normally',
      actual: plain.view.capture,
      expected: null,
    });
  });
});
