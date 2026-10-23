import { createOpenRouter } from '../src/openrouter';

const key = process.env.OPENROUTER_API_KEY;
if (!key)
  throw new Error(
    'OPENROUTER_API_KEY capability is required for the real PCM proof',
  );
const provider = createOpenRouter({ apiKey: key, fetch });
const output = await provider.speakPcm({
  model: 'deepgram/aura-2',
  voice: 'aura-2-thalia-en',
  text: 'This synthetic audio proves the Daisy publication format.',
});
if (
  output.sampleRate !== 24000 ||
  output.channels !== 1 ||
  !(output.pcm instanceof Int16Array) ||
  output.pcm.length === 0 ||
  output.pcm.length > 24000 * 60 ||
  !output.pcm.some((sample) => sample !== 0)
)
  throw new Error('Real provider PCM format proof failed');
process.stdout.write(
  JSON.stringify({
    proof: 'actual-provider-pcm',
    model: 'deepgram/aura-2',
    voice: 'aura-2-thalia-en',
    sampleRate: output.sampleRate,
    channels: output.channels,
    samples: output.pcm.length,
    durationMs: output.pcm.length / 24,
    publicationCredit: false,
  }) + '\n',
);
