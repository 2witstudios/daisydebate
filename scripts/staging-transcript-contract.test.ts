import { assert, setupRitewayBun, test } from 'riteway/bun';
import { expect } from 'bun:test';
import {
  requireStagingTranscriptTarget,
  transcriptProofProblems,
} from './staging-transcript-contract';

setupRitewayBun();
const sha = 'a'.repeat(40);
test('the provider proof refuses another deployment before opening a database', () => {
  const target = {
    origin: 'https://daisy-debate-staging.fly.dev',
    app: 'daisy-debate-staging',
    commit: sha,
    expectedCommit: sha,
  };
  requireStagingTranscriptTarget(target);
  for (const changed of [
    { origin: 'https://daisydebate.com' },
    { app: 'daisy-production' },
    { commit: 'b'.repeat(40) },
    { expectedCommit: 'main' },
  ])
    expect(() =>
      requireStagingTranscriptTarget({ ...target, ...changed }),
    ).toThrow('Staging transcript proof target mismatch');
});
test('COMPLETE alone cannot pass a proof with an unpublished seat or fake provider', () => {
  const stream = {
    role: 'affirmative',
    state: 'complete',
    chunks: 3,
    observedMs: 1000,
    publishedMs: 1000,
    realSpeech: true,
    realTts: true,
    realStt: true,
  };
  const proof = {
    completeness: 'complete',
    decisive: true,
    aiBallot: true,
    streams: [stream, { ...stream, role: 'negative' }],
  };
  assert({
    given:
      'both actual debater publications, observed audio, real speech/TTS/STT and a COMPLETE freeze',
    should: 'pass',
    actual: transcriptProofProblems(proof),
    expected: [],
  });
  for (const changed of [
    { streams: [stream] },
    { completeness: 'incomplete' },
    { aiBallot: false },
    { streams: [stream, { ...stream, role: 'negative', realStt: false }] },
    { streams: [stream, { ...stream, role: 'negative', chunks: 0 }] },
    { streams: [stream, { ...stream, role: 'negative', state: 'partial' }] },
  ])
    assert({
      given: 'an incomplete or synthetic proof',
      should: 'refuse the claim',
      actual: transcriptProofProblems({ ...proof, ...changed }).length > 0,
      expected: true,
    });
});
