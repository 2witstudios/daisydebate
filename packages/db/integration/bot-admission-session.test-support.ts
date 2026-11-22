import { createAppError } from '@daisy/errors';
import {
  decideBotClaimActivity,
  botClaimSeatAdmitted,
  decideBotGeneration,
} from '@daisy/protocol/bot-admission';
import { refuseFinalSpeech, type BotAdmission } from '../src/bot-publication';
/** Trusted fixture composition uses the canonical portable decisions; app caller proof lives in web. */
export const fixtureBotAdmission: BotAdmission = {
  claimAdmission: async (session) => {
    if (!botClaimSeatAdmitted(session.round, session.seat))
      throw createAppError('AUTHORIZATION');
    const activity = decideBotClaimActivity(
      session.round,
      session.seat,
      await session.readControl(),
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
  generationAdmission: async (session) => {
    const { request, worker } = session;
    const answered =
      request.kind === 'language' &&
      worker.kind === 'speech' &&
      (await session.readAnswered());
    const said =
      request.kind === 'language' &&
      worker.kind === 'speech' &&
      !answered &&
      (await session.readSaid());
    const decision =
      request.kind === 'tts'
        ? decideBotGeneration({
            kind: 'tts',
            ...session.speechPolicy(),
            spoken: await session.readSpoken(),
            characters: request.characters,
          })
        : decideBotGeneration({
            kind: 'language',
            model: worker.model,
            workerKind: worker.kind,
            answered,
            said,
          });
    if (decision.kind === 'unconfigured')
      throw createAppError('INFRASTRUCTURE');
    if (decision.kind === 'final') throw refuseFinalSpeech(decision.message);
    await session.apply(decision.model);
  },
};
