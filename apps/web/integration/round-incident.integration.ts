import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createLogger } from '@daisy/logger';
import {
  readRoundOpening,
  roundWaitingOn,
  type MediaObservation,
} from '@daisy/debate-engine';
import { createId } from '@paralleldrive/cuid2';
import { readRoundIncidentRate } from '@daisy/db/round-incident-rate';
import { createRoundIncidentObserver } from '../src/features/round-incidents/observe';
import {
  captureWorkerScope,
  startCaptureSpeech,
  withMediaRound,
} from './round-media.test-support';
setupRitewayBun();
requireTestServices(process.env);

type Fixture = Parameters<Parameters<typeof withMediaRound>[0]>[0];

const pause = (ms: number) =>
  new Promise((done) => {
    setTimeout(done, ms);
  });
const room = (over: Partial<Extract<MediaObservation, { kind: 'room' }>>) =>
  ({
    kind: 'room',
    captureListed: true,
    seatsListed: true,
    speakerHeard: null,
    ...over,
  }) as const;

/** A Round with its first speech open, and the real observer over the real store. */
const liveSpeech = async (f: Fixture) => {
  await captureWorkerScope(f);
  await startCaptureSpeech(f);
  await f.mediaOperations.reconcile(f.roundId);
  const alerts: unknown[] = [];
  const observer = createRoundIncidentObserver({
    store: f.store.roundIncidents,
    reporter: {
      capture: (error: unknown) => {
        alerts.push(error);
      },
    } as never,
    logger: createLogger({ service: 'round-incident-proof', level: 'silent' }),
    nextId: createId,
  });
  const observe = async (observation: MediaObservation) => {
    // Always through the transaction: the skip is proven in the engine's table.
    const round = await f.store.getRound(f.roundId);
    await observer({
      roundId: f.roundId,
      observation,
      nowMs: Date.now(),
      known: {
        incident: { phase: 'paused' } as never,
        status: round!.status,
      },
    });
  };
  return { alerts, observe };
};
/** What a recovery pass commits when it leaves a lost room. */
const retireRoom = (f: Fixture) =>
  f.sql`insert into media_room_rotations (id, round_id, rotated_at, cause) values (${createId()}, ${f.roundId}, clock_timestamp(), 'lost')`;
const checkpointOf = async (f: Fixture) => {
  const [row] =
    await f.sql`select status, outcome, final_segment_ended_at, runtime_state from rounds where id=${f.roundId}`;
  return row!;
};
const incidentsOf = (f: Fixture) =>
  f.sql`select cause, detected_at, resumed_at, ended_at, returned_ms from round_incidents where round_id=${f.roundId} order by detected_at`;
const segmentOf = async (f: Fixture) => {
  const [row] =
    await f.sql`select id, started_at, duration_ms, returned_ms, due_at, ended_at from round_segments where round_id=${f.roundId} order by sequence desc limit 1`;
  return row!;
};
/** The countdown's own end, moved to the past: no test sleeps through a real countdown. */
const finishCountdown = (f: Fixture) =>
  f.sql`update rounds set runtime_state = jsonb_set(runtime_state, '{incident,until}', to_jsonb(to_char((clock_timestamp() - interval '1 millisecond') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) where id=${f.roundId}`;
/** The pause's start, moved past the bound. */
const passBound = (f: Fixture) =>
  f.sql`update rounds set runtime_state = jsonb_set(runtime_state, '{incident,since}', to_jsonb(to_char((clock_timestamp() - interval '10 minutes') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) where id=${f.roundId}`;

test('a node outage pauses a live speech, and recovery gives its time back', async () => {
  await withMediaRound(async (f) => {
    const { alerts, observe } = await liveSpeech(f);
    const before = await segmentOf(f);
    await observe(room({}));
    await retireRoom(f);
    await observe(room({ captureListed: false }));
    const held = await checkpointOf(f);
    const intervals =
      await f.sql`select count(*)::int as open from round_speaking_intervals where round_id=${f.roundId} and ended_at is null`;
    assert({
      given: 'a room that emptied having held capture, observed twice',
      should: 'hold the Round, close speaking, and raise one alert for one row',
      actual: {
        phase: held.runtime_state.incident.phase,
        cause: held.runtime_state.incident.cause,
        status: held.status,
        open: intervals[0]!.open,
        alerts: alerts.length,
        rows: (await incidentsOf(f)).length,
      },
      expected: {
        phase: 'paused',
        cause: 'room_retired',
        status: 'active',
        open: 0,
        alerts: 1,
        rows: 1,
      },
    });

    await f.mediaOperations.reconcile(f.roundId).catch(() => undefined);
    assert({
      given: 'a recovery pass ticking the clock during the hold',
      should: 'not close the speech',
      actual: (await segmentOf(f)).ended_at,
      expected: null,
    });

    await observe(room({}));
    const resuming = await checkpointOf(f);
    assert({
      given: 'the platform and every seat back',
      should: 'begin the automatic countdown',
      actual: resuming.runtime_state.incident.phase,
      expected: 'resuming',
    });

    await finishCountdown(f);
    await f.mediaOperations.reconcile(f.roundId).catch(() => undefined);
    const after = await segmentOf(f);
    const reopened =
      await f.sql`select count(*)::int as open from round_speaking_intervals where round_id=${f.roundId} and ended_at is null`;
    const dueMoved =
      new Date(after.due_at).getTime() - new Date(before.due_at).getTime();
    const [row] = await incidentsOf(f);
    assert({
      given: 'the first tick after the countdown',
      should:
        'run the clock again, with the speech owed exactly its returned airtime',
      actual: {
        phase: (await checkpointOf(f)).runtime_state.incident.phase,
        open: reopened[0]!.open,
        dueMovedByReturned: dueMoved === Number(after.returned_ms),
        returned: Number(after.returned_ms) > 0,
        ruleDurationKept: after.duration_ms === before.duration_ms,
        resumed: row!.resumed_at !== null,
        ended: row!.ended_at,
      },
      expected: {
        phase: 'none',
        open: 1,
        dueMovedByReturned: true,
        returned: true,
        ruleDurationKept: true,
        resumed: true,
        ended: null,
      },
    });
  });
});

test('no recovery within the bound ends the Round with no outcome', async () => {
  await withMediaRound(async (f) => {
    const { alerts, observe } = await liveSpeech(f);
    await observe(room({}));
    await retireRoom(f);
    await observe(room({ captureListed: false }));
    await passBound(f);
    await observe({ kind: 'unreachable' });
    const ended = await checkpointOf(f);
    const [row] = await incidentsOf(f);
    assert({
      given: 'a hold past the bound with the vendor still unreachable',
      should: 'abandon the Round with no outcome, and record the ending',
      actual: {
        status: ended.status,
        outcome: ended.outcome,
        finalEnd: ended.final_segment_ended_at !== null,
        incidentEnded: row!.ended_at !== null,
        resumed: row!.resumed_at,
        phase: ended.runtime_state.incident.phase,
        speechClosed: (await segmentOf(f)).ended_at !== null,
        alerts: alerts.length,
        receipt: (
          await f.store.readLaunchedRound(
            f.roundId,
            f.host,
            () => true,
            readRoundOpening,
            roundWaitingOn,
          )
        )?.platformEnding,
      },
      expected: {
        status: 'abandoned',
        outcome: null,
        finalEnd: true,
        incidentEnded: true,
        resumed: null,
        phase: 'none',
        speechClosed: true,
        alerts: 1,
        receipt: 'recovery_bound',
      },
    });
  });
});

test('a speech resumes from the last confirmed audio', async () => {
  const pointOf = async (
    prove: (
      f: Fixture,
      holder: { segment: string; seat: string; at: Date },
    ) => Promise<unknown>,
  ) => {
    let actual: { confirmedMs: number; expectedMs: number } | null = null;
    await withMediaRound(async (f) => {
      const { observe } = await liveSpeech(f);
      const [open] =
        await f.sql`select segment_id, round_participant_id, started_at from round_speaking_intervals where round_id=${f.roundId} and ended_at is null limit 1`;
      const at = new Date(new Date(open!.started_at).getTime() + 400);
      await prove(f, {
        segment: String(open!.segment_id),
        seat: String(open!.round_participant_id),
        at,
      });
      await observe(room({}));
      await retireRoom(f);
      await observe(room({ captureListed: false }));
      const { runtime_state: state } = await checkpointOf(f);
      actual = {
        confirmedMs: Date.parse(state.incident.resume_point),
        expectedMs: at.getTime(),
      };
    });
    return actual!;
  };
  const human = await pointOf(async (f, { segment, seat, at }) => {
    await f.sql`insert into transcript_segments(round_id, segment_id, round_participant_id) values (${f.roundId}, ${segment}, ${seat})`;
    await f.sql`insert into transcript_observations(id, round_id, segment_id, round_participant_id, track_id, worker_epoch, observed_from, observed_until) values (${createId()}, ${f.roundId}, ${segment}, ${seat}, 'track', 1, ${new Date(at.getTime() - 100)}, ${at})`;
  });
  assert({
    given: 'a human holder capture heard up to an instant',
    should: 'resume from transcript_observations.observed_until',
    actual: human.confirmedMs,
    expected: human.expectedMs,
  });
  const bot = await pointOf(async (f, { segment, seat, at }) => {
    await f.sql`insert into round_bot_publication_windows(id, round_id, segment_id, round_participant_id, credited_from, credited_until) values (${createId()}, ${f.roundId}, ${segment}, ${seat}, ${new Date(at.getTime() - 100)}, ${new Date(at.getTime() + 5_000)})`;
    await f.sql`insert into transcript_segments(round_id, segment_id, round_participant_id) values (${f.roundId}, ${segment}, ${seat})`;
    await f.sql`insert into transcript_observations(id, round_id, segment_id, round_participant_id, track_id, worker_epoch, observed_from, observed_until) values (${createId()}, ${f.roundId}, ${segment}, ${seat}, 'track', 1, ${new Date(at.getTime() - 100)}, ${at})`;
  });
  assert({
    given: 'a bot holder credited past what capture heard',
    should: 'resume from what capture heard: a credit confirms nothing',
    actual: bot.confirmedMs,
    expected: bot.expectedMs,
  });
});

test('ending one incident leaves an earlier one as it was', async () => {
  await withMediaRound(async (f) => {
    const { observe } = await liveSpeech(f);
    await observe(room({}));
    await retireRoom(f);
    await observe(room({ captureListed: false }));
    await observe(room({}));
    await finishCountdown(f);
    await f.mediaOperations.reconcile(f.roundId).catch(() => undefined);
    const [first] = await incidentsOf(f);
    await retireRoom(f);
    await observe(room({ captureListed: false }));
    await passBound(f);
    await observe({ kind: 'unreachable' });
    const rows = await incidentsOf(f);
    const { platform_ending: ending } = (
      await f.sql`select platform_ending from rounds where id=${f.roundId}`
    )[0]!;
    assert({
      given: 'a resumed incident, then a second that reaches the bound',
      should:
        'keep the first as resumed with its airtime, and end only the second',
      actual: {
        rows: rows.length,
        firstResumed: rows[0]!.resumed_at !== null,
        firstReturned: rows[0]!.returned_ms === first!.returned_ms,
        firstEnded: rows[0]!.ended_at,
        secondEnded: rows[1]!.ended_at !== null,
        ending,
      },
      expected: {
        rows: 2,
        firstResumed: true,
        firstReturned: true,
        firstEnded: null,
        secondEnded: true,
        ending: 'recovery_bound',
      },
    });
  });
});

test('a retirement outlives a failed observation', async () => {
  await withMediaRound(async (f) => {
    const { alerts, observe } = await liveSpeech(f);
    await observe(room({}));
    await retireRoom(f);
    const failing = createRoundIncidentObserver({
      store: {
        readRoundIncidentWatch: f.store.roundIncidents.readRoundIncidentWatch,
        observeRoundIncident: async () => {
          throw new Error('lane refused');
        },
      } as never,
      reporter: { capture: () => undefined } as never,
      logger: createLogger({
        service: 'round-incident-proof',
        level: 'silent',
      }),
      nextId: createId,
    });
    await failing({
      roundId: f.roundId,
      observation: room({}),
      nowMs: Date.now(),
      known: {
        incident: { phase: 'none' },
        status: 'active',
      },
    });
    await observe(room({}));
    const watch = await f.store.roundIncidents.readRoundIncidentWatch(
      f.roundId,
    );
    assert({
      given: 'the observation failing in the pass that retired the room',
      should:
        'still pause and alert on the next pass, whose read is healthy, and take it up once',
      actual: {
        phase: (await checkpointOf(f)).runtime_state.incident.phase,
        alerts: alerts.length,
        pending: watch.roomRetired,
      },
      expected: { phase: 'paused', alerts: 1, pending: false },
    });
  });
});

test('a failure after the countdown ended, before any tick, settles the resume first', async () => {
  await withMediaRound(async (f) => {
    const { alerts, observe } = await liveSpeech(f);
    await observe(room({}));
    await retireRoom(f);
    await observe(room({ captureListed: false }));
    await observe(room({}));
    await finishCountdown(f);
    await retireRoom(f);
    await observe(room({ captureListed: false }));
    const rows = await incidentsOf(f);
    const after = await segmentOf(f);
    assert({
      given: 'a due resume nobody has ticked, and a new failure',
      should: 'resume the first incident, open a second, and alert for each',
      actual: {
        phase: (await checkpointOf(f)).runtime_state.incident.phase,
        rows: rows.length,
        firstResumed: rows[0]!.resumed_at !== null,
        returned: Number(after.returned_ms) > 0,
        alerts: alerts.length,
      },
      expected: {
        phase: 'paused',
        rows: 2,
        firstResumed: true,
        returned: true,
        alerts: 2,
      },
    });
  });
});

test('attendance holds while an incident is open', async () => {
  await withMediaRound(async (f) => {
    const { observe } = await liveSpeech(f);
    await observe(room({}));
    await retireRoom(f);
    await observe(room({ captureListed: false }));
    const instanceId = createId();
    await f.store.renewServiceInstance({ instanceId, role: 'web' });
    const outcome = await f.store.evaluateRoundAttendance({
      roundId: f.roundId,
      commandId: createId(),
      instanceId,
      nextWindow: () => {
        throw new Error('A held Round must not look for a window');
      },
      judgingEndReason: () => {
        throw new Error('A held Round ends no job');
      },
      resolveOnReceipts: () => {
        throw new Error('A held Round must not decide');
      },
      resolve: () => {
        throw new Error('A held Round must not decide');
      },
    } as never);
    const [row] =
      await f.sql`select count(*)::int as decided from round_attendance_adjudications where round_id=${f.roundId}`;
    await f.sql`delete from service_instances where instance_id=${instanceId}`;
    assert({
      given: 'an attendance pass during an open incident',
      should: 'hold, and write no immutable decision',
      actual: { outcome, decided: row!.decided },
      expected: {
        outcome: { kind: 'held', reason: 'platform_incident' },
        decided: 0,
      },
    });
  });
});

test('a platform-ended Round charges nothing, once', async () => {
  await withMediaRound(async (f) => {
    const { observe } = await liveSpeech(f);
    const [seat] =
      await f.sql`select actor_id from round_participants where round_id=${f.roundId} limit 1`;
    const id = createId();
    // Spent and counted: a billable call was really served in this Round.
    await f.sql`insert into usage_reservations(id, actor_id, round_id, kind, counted_at) values (${id}, ${seat!.actor_id}, ${f.roundId}, 'ai_round', clock_timestamp())`;
    await observe(room({}));
    await retireRoom(f);
    await observe(room({ captureListed: false }));
    await passBound(f);
    await observe({ kind: 'unreachable' });
    const [first] =
      await f.sql`select refunded_at from usage_reservations where id=${id}`;
    await observe({ kind: 'unreachable' });
    const [second] =
      await f.sql`select refunded_at from usage_reservations where id=${id}`;
    assert({
      given: 'a served practice call in a Round the platform ended',
      should: 'refund it, and a later observation changes nothing',
      actual: {
        refunded: first!.refunded_at !== null,
        once:
          new Date(first!.refunded_at).getTime() ===
          new Date(second!.refunded_at).getTime(),
      },
      expected: { refunded: true, once: true },
    });
  });
});

test('the incident rate reads round_incidents and capture coverage reads the freezes', async () => {
  await withMediaRound(async (f) => {
    const { observe } = await liveSpeech(f);
    await observe(room({}));
    await retireRoom(f);
    await observe(room({ captureListed: false }));
    const from = new Date(Date.now() - 86_400_000);
    const until = new Date(Date.now() + 60_000);
    const rate = await readRoundIncidentRate(f.sql, { from, until });
    assert({
      given: 'one Round held in the period',
      should: 'count it, and read a rate from real Round-hours',
      actual: {
        counted: rate.incidents >= 1,
        hasHours: rate.roundHours > 0,
        rate:
          rate.incidentsPer1000RoundHours ===
          (rate.incidents / rate.roundHours) * 1000,
      },
      expected: { counted: true, hasHours: true, rate: true },
    });
  });
});

test('a reservation never counted needs no refund when the platform ends the Round', async () => {
  await withMediaRound(async (f) => {
    const { observe } = await liveSpeech(f);
    const [seat] =
      await f.sql`select actor_id from round_participants where round_id=${f.roundId} limit 1`;
    const id = createId();
    await f.sql`insert into usage_reservations(id, actor_id, round_id, kind) values (${id}, ${seat!.actor_id}, ${f.roundId}, 'ai_round')`;
    await observe(room({}));
    await retireRoom(f);
    await observe(room({ captureListed: false }));
    await passBound(f);
    await observe({ kind: 'unreachable' });
    const [row] =
      await f.sql`select refunded_at from usage_reservations where id=${id}`;
    assert({
      given: 'an AI practice whose first billable call never came',
      should:
        'still end the Round: the allowance spends it only while the Round is live',
      actual: {
        status: (await checkpointOf(f)).status,
        refunded: row!.refunded_at,
      },
      expected: { status: 'abandoned', refunded: null },
    });
  });
});

test('a later retirement waits for its own decision', async () => {
  await withMediaRound(async (f) => {
    const { observe } = await liveSpeech(f);
    await retireRoom(f);
    await observe(room({ captureListed: false }));
    await pause(2);
    await retireRoom(f);
    const watch = await f.store.roundIncidents.readRoundIncidentWatch(
      f.roundId,
    );
    assert({
      given: 'a room retired again after an earlier retirement was taken up',
      should: 'still be waiting for a decision',
      actual: watch.roomRetired,
      expected: true,
    });
  });
});

test('a platform ending agrees with the status', async () => {
  await withMediaRound(async (f) => {
    const refused =
      await f.sql`update rounds set platform_ending='recovery_bound' where id=${f.roundId}`.then(
        () => null,
        (error: { constraint_name?: string; message?: string }) =>
          error.constraint_name ?? error.message ?? 'refused',
      );
    assert({
      given: 'recovery_bound on a Round that is not abandoned',
      should: 'be refused',
      actual: String(refused).includes('rounds_platform_ending_check'),
      expected: true,
    });
  });
});
