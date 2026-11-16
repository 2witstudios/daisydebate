import { randomBytes } from 'node:crypto';
import { requireTestServices } from '@daisy/config';
import { canUseAiAllowance } from '@daisy/auth/authorization';
import { createOpenRouter, judgeContractVersion } from '@daisy/ai-voice';
import { judgingJobRules } from '@daisy/debate-engine';
import { scratchDatabase, daisyOrganizationId } from '@daisy/db/testing';
import {
  daisyWinnerBallot,
  judgeSeat,
  isDebatingSeat,
  seatOrder,
  scoreLatticeValues,
  type BallotDefinition,
  type CaseMap,
} from '@daisy/protocol';
import {
  oneOnOneDefinition,
  oneOnOneSettings,
} from '@daisy/db/reference-formats';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withRoomRuntime } from './room-runtime.test-support';
import {
  everyoneReady,
  playOut,
  readBallotAs,
} from './round-judging.test-support';
import {
  finalizeAsWeb,
  finalizeByMaintenance,
} from './round-maintenance.test-support';
import { seedSettledAttendanceLedger } from './round-attendance-fixture.test-support';
import { createRoundJudgingOperations } from '../src/features/round-judging/operations';
import { createProviderBudget } from '../src/server/provider-budget';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

/** No invented claims or line citations: the controlled complete capture contains silence. */
const emptyCaseMap: CaseMap = {
  about: { question: '', affirmative: '', negative: '' },
  cases: {
    affirmative: {
      thesis: { id: '', claim: '', line: '' },
      framework: '',
      burdens: [],
    },
    negative: {
      thesis: { id: '', claim: '', line: '' },
      framework: '',
      burdens: [],
    },
  },
  framework: { dispute: '', contested: [], ruling: '', liveBurdens: [] },
  attacks: [],
  concessions: [],
  coherence: { affirmative: [], negative: [] },
  standing: { affirmative: [], negative: [] },
};

// This original custom grammar has only two scored speeches; it is authored
// before Room creation, never rewritten to make a published fixture fit.
const scoredSpeechFormat = {
  ...oneOnOneDefinition,
  segments: oneOnOneDefinition.segments.filter((segment) =>
    ['AC', 'NC'].includes(segment.key),
  ),
  configurable: {
    ...oneOnOneDefinition.configurable,
    timing: {
      ...oneOnOneDefinition.configurable.timing,
      segmentDurationMs: Object.fromEntries(
        Object.entries(
          oneOnOneDefinition.configurable.timing.segmentDurationMs,
        ).filter(([key]) => ['AC', 'NC'].includes(key)),
      ),
    },
  },
};
for (const per of ['side', 'seat', 'speech'] as const)
  test(`DEC408 actual AI first/map/final freezes and stores ${per} subjects with exact source, weights and text off`, async () => {
    const scratch = scratchDatabase(databaseUrl, 'customballotai');
    await scratch.create();
    try {
      await scratch.migrate(() => true);
      await withRoomRuntime(
        async (f) => {
          const definition: BallotDefinition = {
            ...daisyWinnerBallot,
            key: 'stored-ai-proof',
            revision: 1,
            decision: {
              kind: 'winner',
              lowPointWin: true,
              tie: false,
              doubleLoss: true,
            },
            speakerRanks: per !== 'side',
            points: {
              ...daisyWinnerBallot.points!,
              per,
              ...(per === 'speech' ? { weights: { AC: 2, NC: 0.5 } } : {}),
              scale: { min: 0.25, max: 1.25, step: 0.1 },
              default: 0.35,
              criteria: { kind: 'holistic' },
            },
            written: { reason: null, feedback: null },
          };
          const ballotId = createId();
          await f.sql.begin(async (tx) => {
            await tx`insert into ballot_definitions(id,organization_id,name,current_version) values(${ballotId},${daisyOrganizationId},'AI immutable source proof',1)`;
            await tx`insert into ballot_definition_versions(ballot_definition_id,version,organization_id,definition) values(${ballotId},1,${daisyOrganizationId},${JSON.stringify(definition)}::text::jsonb)`;
          });
          let room = await f.assemble({
            selection:
              per === 'speech'
                ? {
                    kind: 'custom',
                    definition: scoredSpeechFormat,
                    config: oneOnOneSettings,
                    competitionType: 'casual',
                  }
                : {
                    kind: 'catalog',
                    formatId: 'policy',
                    formatVersion: 1,
                    presetVersion: 1,
                    competitionType: 'casual',
                  },
          });
          const ai = await f.aiJudge();
          room = (
            await f.command(f.host, room, {
              type: 'assign-seat',
              seat: judgeSeat(0),
              actorId: ai.actorId,
            })
          ).view;
          await f.sql`update rooms set ballot_definition_id=${ballotId},ballot_definition_version=1 where id=${room.id}`;
          room = await everyoneReady(f, room, [f.host, f.guest]);
          const launched = await f.command(f.host, room, {
            type: 'start-round',
          });
          const roundId = launched.view.roundRef!.id;
          await playOut(f, roundId, true);
          const freeze = await finalizeAsWeb(f, roundId);
          if (
            freeze.status !== 'frozen' ||
            freeze.freeze.completeness !== 'complete'
          )
            throw new Error('Expected the real complete transcript freeze');
          // Storage/worker contract proof, separate from the full availability sampler journey.
          await seedSettledAttendanceLedger(f, roundId);
          const round = (await f.store.getRound(roundId))!;
          const speakerIds = round.participants
            .filter((p) => isDebatingSeat(p.seat))
            .sort((a, b) => seatOrder(round.rules.sides)(a.seat, b.seat))
            .map((p) => p.id);
          const scores =
            per === 'side'
              ? { affirmative: 0.35, negative: 0.25 }
              : per === 'seat'
                ? Object.fromEntries(
                    speakerIds.map((id, index) => [
                      id,
                      index === 0 ? 0.35 : 0.25,
                    ]),
                  )
                : { AC: 0.7, NC: 0.125 };
          const ballot = {
            rubricVersion: 'stored-ai-proof@1',
            decision: 'double_loss',
            winner: null,
            scores,
            ...(per !== 'side'
              ? { speakerRanks: speakerIds.map((id) => [id]) }
              : {}),
          };
          const requests: {
            name: string;
            values: unknown;
            reason: unknown;
            feedback: unknown;
            prompt: string;
          }[] = [];
          const voice = createOpenRouter({
            apiKey: 'noncredential-controlled-provider',
            fetch: async (_url, init) => {
              const request = JSON.parse(String(init?.body));
              const format = request.response_format.json_schema;
              requests.push({
                name: format.name,
                values: Object.fromEntries(
                  Object.entries(
                    format.schema.properties.scores?.properties ?? {},
                  ).map(([key, value]) => [
                    key,
                    (value as { enum?: unknown }).enum,
                  ]),
                ),
                reason: format.schema.properties.reason,
                feedback: format.schema.properties.feedback,
                prompt: request.messages
                  .map((message: { content: string }) => message.content)
                  .join('\n'),
              });
              return Response.json({
                choices: [
                  {
                    message: {
                      content: JSON.stringify(
                        format.name === 'case_map' ? emptyCaseMap : ballot,
                      ),
                    },
                    finish_reason: 'stop',
                  },
                ],
                usage: { prompt_tokens: 3, completion_tokens: 2 },
              });
            },
          });
          const operations = createRoundJudgingOperations({
            store: f.store,
            nextId: createId,
            voice: () => voice,
            withProvider: createProviderBudget(1),
          });
          const sources = [];
          for (let stage = 0; stage < 3; stage += 1) {
            const target = (
              await f.store.scanRoundJudgingJobs(64, 'generation')
            ).find((target) => target.roundId === roundId);
            if (!target)
              throw new Error(`Actual judging stage ${stage} not due`);
            const claim = await f.store.claimRoundJudgingJob(target);
            sources.push(claim.round.judging?.source);
            await operations.executeClaim(claim, new AbortController().signal);
          }
          await finalizeByMaintenance(f, roundId);
          const read = await readBallotAs(f, f.host, roundId);
          const [stored] =
            await f.sql`select b.ballot_definition_id,b.ballot_definition_version,b.reason,b.feedback,j.status,(select array_agg(distinct a.contract_version order by a.contract_version) from round_judging_attempts a where a.round_id=b.round_id) as contract_versions,(select count(*)::int from round_judging_attempts a where a.round_id=b.round_id) as attempts from ballots b join round_judging_jobs j on j.round_id=b.round_id and j.judge_participant_id=b.judge_participant_id where b.round_id=${roundId}`;
          assert({
            given:
              'real queued first/map/final stages on a custom pinned definition and controlled provider transport',
            should:
              'carry the exact source, scale, text-off contract and stored reference through completion',
            actual: {
              sources,
              requests: requests.map((request) => [
                request.name,
                request.values,
                request.reason,
                request.feedback,
                request.name === 'case_map' ||
                  (per === 'side'
                    ? request.prompt.includes('0.25 to 1.25 in steps of 0.1')
                    : speakerIds.every((id) => request.prompt.includes(id)) &&
                      request.prompt.includes('Frozen subject legend')),
              ]),
              stored,
              ballot: read.ballots[0]?.ballot,
              status: read.round.status,
            },
            expected: {
              sources: Array.from({ length: 3 }, () => ({
                kind: 'stored',
                id: ballotId,
                version: 1,
              })),
              requests: [
                [
                  'ballot',
                  Object.fromEntries(
                    Object.keys(scores).map((key) => [
                      key,
                      scoreLatticeValues(
                        definition.points!.scale,
                        per === 'speech' ? definition.points!.weights![key] : 1,
                      ),
                    ]),
                  ),
                  undefined,
                  undefined,
                  true,
                ],
                ['case_map', {}, undefined, undefined, true],
                [
                  'ballot',
                  Object.fromEntries(
                    Object.keys(scores).map((key) => [
                      key,
                      scoreLatticeValues(
                        definition.points!.scale,
                        per === 'speech' ? definition.points!.weights![key] : 1,
                      ),
                    ]),
                  ),
                  undefined,
                  undefined,
                  true,
                ],
              ],
              stored: {
                ballot_definition_id: ballotId,
                ballot_definition_version: 1,
                reason: null,
                feedback: null,
                status: 'succeeded',
                contract_versions: [judgeContractVersion],
                attempts: 3,
              },
              ballot,
              status: 'completed',
            },
          });
        },
        {
          databaseUrl: scratch.url,
          judging: {
            leaseMs: 60_000,
            model: 'controlled-source-contract',
            nextToken: () => randomBytes(32).toString('base64url'),
            contractVersion: judgeContractVersion,
            rules: judgingJobRules,
            accountEligible: canUseAiAllowance,
          },
        },
      );
    } finally {
      await scratch.drop();
    }
  }, 60_000);
