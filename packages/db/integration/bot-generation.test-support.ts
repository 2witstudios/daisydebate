import { withBotPublication } from './bot-publication.test-support';
import {
  admissionSponsor,
  testBotAdmission,
} from './bot-admission.test-support';
import type { createRoundBotAdmission } from '../src/round-bot-admission';

type Publication = Parameters<Parameters<typeof withBotPublication>[0]>[0];
type Reservation = Awaited<
  ReturnType<ReturnType<typeof createRoundBotAdmission>['reserve']>
>;
/** A bot seat with a reserved AI practice admission and a 10-character speech budget. */
export async function withGeneration(
  work: (value: Publication & { reservation: Reservation }) => Promise<void>,
) {
  await withBotPublication(
    async (context) => {
      const { fixture, run, target } = context;
      const actorId = await admissionSponsor(fixture, [target.roundId]);
      const admission = testBotAdmission(run);
      const reservation = await admission.reserve({
        roundId: target.roundId,
        actorId,
      });
      await work({ ...context, reservation });
    },
    { ttsModel: 'deepgram/aura-2', speechBudget: 10 },
  );
}
