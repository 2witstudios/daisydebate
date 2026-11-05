// Predecessor cutover probe, retained in its immutable checkpoint receipt.
import { createInterface } from 'node:readline';
import { createOpenRouter } from '@daisy/ai-voice';
import type { Database } from '@daisy/db';
import { sampleRoundAnalysisReport } from '@daisy/protocol/round-analysis-testing';
import { createRoundAnalysisOperations } from '../src/features/round-analysis/operations';
const lines = createInterface({ input: process.stdin });
const iterator = lines[Symbol.asyncIterator]();
const first = await iterator.next();
const claim = JSON.parse(first.value!) as NonNullable<
  Awaited<ReturnType<Database['claimRoundAnalysisJob']>>
>;
const abort = new AbortController();
const released = Promise.withResolvers<void>();
const emit = (message: string) => process.stdout.write(`${message}\n`);
const commands = (async () => {
  for await (const line of { [Symbol.asyncIterator]: () => iterator }) {
    if (line === 'abort') abort.abort();
    if (line === 'release') {
      released.resolve();
      return;
    }
  }
})();
process.on('SIGTERM', () => abort.abort());
const provider = createOpenRouter({
  apiKey: 'isolated-cutover-fixture',
  fetch: async () => {
    emit('fetch');
    return Response.json({
      choices: [
        {
          message: { content: JSON.stringify(sampleRoundAnalysisReport) },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
  },
});
const operations = createRoundAnalysisOperations({
  store: {
    claimRoundAnalysisJob: async () => {
      emit('claimed');
      await released.promise;
      return claim;
    },
    recordRoundAnalysisUsage: async () => {},
    completeRoundAnalysisJob: async () => {},
  },
  betaGrantsPremium: true,
  voice: () => provider,
  withProvider: (_signal, work) => work(),
  now: () => new Date().toISOString(),
});
try {
  await operations.analyse(claim.seat, abort.signal);
  emit('finished');
} catch {
  emit('refused');
}
await commands;
lines.close();
process.stdin.destroy();
