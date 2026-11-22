import { createAppError } from '@daisy/errors';
import {
  decideBotClaimActivity,
  decideBotGeneration,
  botClaimSeatAdmitted,
} from '@daisy/protocol/bot-admission';
import {
  refuseFinalSpeech,
  type BotAdmission,
} from '@daisy/db/bot-publication';

export function requireBotClaimSeat(
  ...args: Parameters<typeof botClaimSeatAdmitted>
) {
  if (!botClaimSeatAdmitted(...args)) throw createAppError('AUTHORIZATION');
}
/** Application admission runs inside the existing worker/usage transaction, never before it. */
export const botAdmission: BotAdmission = {
  async claimAdmission(session) {
    requireBotClaimSeat(session.round, session.seat);
    const segment = await session.readControl();
    const activity = decideBotClaimActivity(
      session.round,
      session.seat,
      segment,
    );
    if (activity.kind !== 'ready')
      throw createAppError(
        'CONFLICT',
        activity.kind === 'open'
          ? 'A bot does not take an open floor'
          : undefined,
      );
    await session.apply(activity.activity);
  },
  async generationAdmission(session) {
    const { request, worker } = session;
    const decision =
      request.kind === 'tts'
        ? decideBotGeneration({
            kind: 'tts',
            ...session.speechPolicy(),
            characters: request.characters,
            spoken: await session.readSpoken(),
          })
        : await (async () => {
            const answered =
              worker.kind === 'speech' && (await session.readAnswered());
            const said =
              worker.kind === 'speech' &&
              !answered &&
              (await session.readSaid());
            return decideBotGeneration({
              kind: 'language',
              workerKind: worker.kind,
              model: worker.model,
              answered,
              said,
            });
          })();
    if (decision.kind === 'unconfigured')
      throw createAppError('INFRASTRUCTURE');
    if (decision.kind === 'final') throw refuseFinalSpeech(decision.message);
    await session.apply(decision.model);
  },
};
