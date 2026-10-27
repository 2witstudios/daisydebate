import { randomBytes } from 'node:crypto';
import {
  oneOnOneDefinition,
  oneOnOneRoomConfig,
} from '@daisy/db/reference-formats';
import {
  startRuntimeRound,
  type withRoomRuntime,
} from './round-runtime.test-support';
import { botAdmissionForTests } from './bot-admission.test-support';
/** Real shared Room/engine launch; custom opening side controls only this test schedule. */
async function controlledSpeech(
  f: Parameters<Parameters<typeof withRoomRuntime>[0]>[0],
  openingSide: 'affirmative' | 'negative',
) {
  const bot = await f.bot();
  let room = (
    await f.create({
      selection: {
        kind: 'custom',
        definition: {
          ...oneOnOneDefinition,
          segments: oneOnOneDefinition.segments.map((segment, index) =>
            index === 0
              ? { ...segment, side: openingSide, label: 'Opening speech' }
              : segment,
          ),
          seats: { ...oneOnOneDefinition.seats, judge: 0 },
        },
        config: {
          ...oneOnOneRoomConfig,
          speechTiming: { ...oneOnOneRoomConfig.speechTiming, countdownMs: 0 },
        },
        competitionType: 'casual',
      },
    })
  ).view;
  room = await f.seatBotOpponent(room, bot.actorId);
  const { roundId, operations } = await startRuntimeRound(f, room);
  await operations.tick(roundId);
  const target = (await f.store.scanRoundBotWorkers(64)).find(
    (candidate) => candidate.roundId === roundId,
  );
  if (!target) throw Error('Expected actual idle bot control target');
  return { roundId, claim: await f.store.claimRoundBotWorker(target) };
}

export const opponentSpeech = (
  f: Parameters<Parameters<typeof withRoomRuntime>[0]>[0],
) => controlledSpeech(f, 'affirmative');
export const ownSpeech = (
  f: Parameters<Parameters<typeof withRoomRuntime>[0]>[0],
) => controlledSpeech(f, 'negative');

export const botControlOptions = {
  ...botAdmissionForTests,
  botPublication: {
    leaseMs: 30000,
    models: { speech: 'explicit-speech', cross_ex: 'explicit-cross' },
    nextToken: () => randomBytes(32).toString('base64url'),
  },
};
