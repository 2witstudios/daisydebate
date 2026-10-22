import {
  oneOnOneDefinition,
  practiceRoomConfig,
} from '@daisy/db/reference-formats';
import {
  startRuntimeRound,
  type withRoomRuntime,
} from './round-runtime.test-support';
/** Real shared Room and first actual human speech; the bot controls the opposite seat. */
export async function opponentSpeech(
  f: Parameters<Parameters<typeof withRoomRuntime>[0]>[0],
) {
  const bot = await f.bot();
  let room = (
    await f.create({
      selection: {
        kind: 'custom',
        definition: {
          ...oneOnOneDefinition,
          seats: { ...oneOnOneDefinition.seats, judge: 0 },
        },
        config: {
          ...practiceRoomConfig,
          speechTiming: { ...practiceRoomConfig.speechTiming, countdownMs: 0 },
        },
        length: 'full',
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
