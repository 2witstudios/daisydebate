import { executeLaunchEvidence } from './launch-evidence-worker';
import { decodeBotSpeechEvidence } from './bot-speech-evidence-decoder';

export async function botSpeechEvidence(roundId: string) {
  return decodeBotSpeechEvidence(
    await executeLaunchEvidence('bot-speech-evidence-process.ts', roundId),
  );
}
