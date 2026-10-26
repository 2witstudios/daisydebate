import { requireTestServices } from '@daisy/config';
import {
  ballotCategories,
  roundBallotReadSchema,
  roundBallotReceiptSchema,
  roundJudgeAssignmentsSchema,
  roundViewSchema,
  type Ballot,
} from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { finalizeAsWeb } from './round-maintenance.test-support';
import {
  createRoomHttpFixture,
  withHumanJudgeHttpRound,
} from './room-http.test-support';
import { withSql } from './fixtures';
setupRitewayBun();
requireTestServices(process.env);
const h = createRoomHttpFixture();
const { f, routes, headers, member } = h;
test('authenticated ballot JSON/native POST and protected GET share actual frozen judge authority without identity leaks', async () => {
  const host = await member(),
    guest = await member(),
    firstJudge = await member(),
    secondJudge = await member();
  await withHumanJudgeHttpRound(
    h,
    { host, guest, judges: [firstJudge, secondJudge], countdownMs: 10000 },
    async ({ roundId, startBody }) => {
      const view = roundViewSchema.parse((startBody as { view: unknown }).view);
      const elapsed = view.rules.segments.reduce(
        (total, s) => total + s.durationMs + view.rules.countdownMs,
        125000,
      );
      await withSql(async (sql) => {
        await sql`update rounds set started_at=clock_timestamp()-${elapsed}*interval '1 millisecond' where id=${roundId}`;
      });
      const finalized = await withSql((sql) =>
        finalizeAsWeb({ store: f.app.database, sql }, roundId),
      );
      if (finalized.status !== 'frozen')
        throw Error('Expected actual frozen input');
      const get = (cookie: string) =>
        routes.rounds.getBallots(
          new Request(`${f.origin}/api/rounds/${roundId}/ballots`, {
            headers: headers(cookie),
          }),
          roundId,
        );
      const own = roundBallotReadSchema.parse(
        await (await get(firstJudge)).json(),
      );
      const blind = roundBallotReadSchema.parse(
        await (await get(guest)).json(),
      );
      const seat = own.own!.participantId;
      const ballot: Ballot = {
        rubricVersion: 'speaker-10@1',
        winner: 'affirmative',
        reason: 'The affirmative answered the decisive clash.',
        feedback: {},
        scores: {
          affirmative: Object.fromEntries(ballotCategories.map((c) => [c, 3])),
          negative: Object.fromEntries(ballotCategories.map((c) => [c, 3])),
        } as Ballot['scores'],
      };
      const envelope = {
        version: 1,
        commandId: createId(),
        expectedVersion: own.round.version,
        judgeParticipantId: seat,
        freezeRevision: own.freeze!.revision,
        ballot,
      };
      const post = (
        cookie: string,
        body: object = envelope,
        origin = f.origin,
      ) =>
        routes.rounds.submitBallot(
          f.jsonPost(`/api/rounds/${roundId}/ballots`, body, {
            cookie,
            origin,
          }),
          roundId,
        );
      const refusals = await Promise.all([
        post(guest),
        post(firstJudge, { ...envelope, actorId: 'a'.repeat(24) }),
        post(firstJudge, envelope, 'https://foreign.invalid'),
        post(firstJudge, {
          ...envelope,
          freezeRevision: envelope.freezeRevision + 1,
        }),
      ]);
      const accepted = await post(firstJudge);
      const receipt = roundBallotReceiptSchema.parse(
        (await accepted.json()).receipt,
      );
      const repeated = await post(firstJudge);
      const replay = roundBallotReceiptSchema.parse(
        (await repeated.json()).receipt,
      );
      const form = new URLSearchParams({
        version: '1',
        commandId: envelope.commandId,
        expectedVersion: String(envelope.expectedVersion),
        judgeParticipantId: seat,
        freezeRevision: String(envelope.freezeRevision),
        winner: ballot.winner,
        reason: ballot.reason,
      });
      for (const side of ['affirmative', 'negative'])
        for (const category of ballotCategories)
          form.set(`${side}-${category}`, '3');
      const native = await routes.rounds.submitBallot(
        new Request(`${f.origin}/api/rounds/${roundId}/ballots`, {
          method: 'POST',
          headers: {
            cookie: firstJudge,
            origin: f.origin,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: form.toString(),
        }),
        roundId,
      );
      const assigned = roundJudgeAssignmentsSchema.parse(
        await (
          await routes.rounds.judgeAssignments(
            new Request(`${f.origin}/api/judge/assignments`, {
              headers: headers(firstJudge),
            }),
          )
        ).json(),
      );
      const empty = roundJudgeAssignmentsSchema.parse(
        await (
          await routes.rounds.judgeAssignments(
            new Request(`${f.origin}/api/judge/assignments`, {
              headers: headers(guest),
            }),
          )
        ).json(),
      );
      const after = roundBallotReadSchema.parse(
        await (await get(firstJudge)).json(),
      );
      const hidden = view.participants
        .filter((p) => p.role === 'judge' && 'actorId' in p)
        .flatMap((p) => ('actorId' in p ? [p.id, p.actorId, p.label] : []));
      assert({
        given:
          'real session cookies, actual D2 freeze and a first of two judge ballots',
        should:
          'store one pending vote, exactly replay JSON/native forms and expose only own assignment/input with honest outcomes',
        actual: {
          refusals: refusals.map((r) => r.status),
          statuses: [accepted.status, repeated.status, native.status],
          same: JSON.stringify(receipt) === JSON.stringify(replay),
          location: native.headers.get('location'),
          outcome: receipt.outcome,
          own: after.own?.status,
          ballots: after.ballots.length,
          assigned: assigned
            .filter((a) => a.roundId === roundId)
            .map((a) => a.ballotStatus),
          empty: empty.length,
          privacy: hidden.filter((id) => JSON.stringify(blind).includes(id)),
          frozenToDebater: blind.freeze,
          ownToDebater: blind.own,
        },
        expected: {
          refusals: [403, 400, 403, 409],
          statuses: [200, 200, 303],
          same: true,
          location: `/judge/ballot/${roundId}`,
          outcome: null,
          own: 'submitted',
          ballots: 0,
          assigned: ['submitted'],
          empty: 0,
          privacy: [],
          frozenToDebater: null,
          ownToDebater: null,
        },
      });
    },
  );
});
