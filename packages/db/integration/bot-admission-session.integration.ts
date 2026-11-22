import { withGeneration } from './bot-generation.test-support';
import { fixtureBotAdmission } from './bot-admission-session.test-support';
import { setupRitewayBun, test, assert } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { canUseAiAllowance } from '@daisy/auth/authorization';
import { createId } from '@paralleldrive/cuid2';
import { randomBytes } from 'node:crypto';
import { createBotPublicationOperations } from '../src/bot-publication';
import { withBotPublication } from './bot-publication.test-support';
setupRitewayBun();
test('a claim admission callback cannot return without settling its bound claim', async () =>
  withBotPublication(async ({ run, target, fixture }) => {
    const operations = createBotPublicationOperations({
      run,
      nextId: createId,
      nextToken: () => randomBytes(32).toString('base64url'),
      leaseMs: 30000,
      models: { speech: 'model', cross_ex: 'model' },
      accountEligible: canUseAiAllowance,
      claimAdmission: async () => {},
      generationAdmission: async () => {},
    });
    await assertRejects({
      given: 'an admission owner that never applies',
      should: 'refuse and roll back the whole claim',
      code: 'CONFLICT',
      actual: () => operations.claimWorker(target),
    });
    const [row] =
      await fixture.sql`select count(*)::int as claims from round_bot_publications where round_id=${target.roundId}`;
    assert({
      given: 'the incomplete claim',
      should: 'write no leased control',
      actual: row.claims,
      expected: 0,
    });
  }));

test('released claim and generation frames stay closed while real SQL cleanup finishes', async () =>
  withGeneration(async ({ run, target, fixture }) => {
    let stage: 'none' | 'claim' | 'generation' = 'claim';
    let pending: Promise<void> | undefined;
    let readReleased: (() => Promise<unknown>) | undefined;
    const operations = createBotPublicationOperations({
      ...fixtureBotAdmission,
      run: (work, options) =>
        run(async (tx, signal, metadata) => {
          try {
            return await work(tx, signal, metadata);
          } catch (error) {
            if (pending && readReleased) {
              await Promise.allSettled([pending]);
              await assertRejects({
                given:
                  stage +
                  ' delayed apply completed during real transaction cleanup',
                should: 'keep the released frame terminal',
                actual: readReleased,
                code: 'CONFLICT',
              });
            }
            throw error;
          }
        }, options),
      nextId: createId,
      nextToken: () => randomBytes(32).toString('base64url'),
      leaseMs: 30000,
      models: { speech: 'model', cross_ex: 'model' },
      ttsModel: 'voice',
      speechBudget: 10,
      accountEligible: canUseAiAllowance,
      claimAdmission: (session) =>
        fixtureBotAdmission.claimAdmission({
          ...session,
          apply: async (activity) => {
            if (stage !== 'claim') return session.apply(activity);
            readReleased = session.readControl;
            pending = session.apply(activity);
            void pending.catch(() => {});
          },
        }),
      generationAdmission: (session) =>
        fixtureBotAdmission.generationAdmission({
          ...session,
          apply: async (model) => {
            readReleased = session.readSpoken;
            pending = session.apply(model);
            void pending.catch(() => {});
          },
        }),
    });
    await assertRejects({
      given: 'an unawaited claim write',
      should: 'refuse unsettled work',
      actual: () => operations.claimWorker(target),
      code: 'CONFLICT',
    });
    pending = undefined;
    readReleased = undefined;
    stage = 'none';
    const claim = await operations.claimWorker(target);
    stage = 'generation';
    await assertRejects({
      given: 'an unawaited generation write',
      should: 'refuse unsettled work',
      actual: () =>
        operations.beginGeneration(claim.scope, claim.token, {
          kind: 'tts',
          characters: 5,
        }),
      code: 'CONFLICT',
    });
    const [row] =
      await fixture.sql`select count(*)::int as executions from agent_runs where round_participant_id=${target.roundParticipantId} and configuration_snapshot ? 'parentAgentRunId'`;
    assert({
      given: 'both rolled-back delayed writes',
      should: 'retain no execution',
      actual: row.executions,
      expected: 0,
    });
  }));
