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
    origin: 'https://beta.daisydebate.com',
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
test('COMPLETE alone cannot pass a proof with a silent seat or fake provider', () => {
  const stream = {
    role: 'affirmative',
    state: 'complete',
    authoredLines: 3,
    realSpeech: true,
    realTts: true,
  };
  const proof = {
    completeness: 'complete',
    decisive: true,
    aiBallot: true,
    streams: [stream, { ...stream, role: 'negative' }],
  };
  assert({
    given:
      'both bots authoring lines they played whole, real speech and TTS, and a COMPLETE freeze',
    should: 'pass',
    actual: transcriptProofProblems(proof),
    expected: [],
  });
  for (const changed of [
    { streams: [stream] },
    { completeness: 'incomplete' },
    { aiBallot: false },
    { streams: [stream, { ...stream, role: 'negative', realTts: false }] },
    { streams: [stream, { ...stream, role: 'negative', authoredLines: 0 }] },
    { streams: [stream, { ...stream, role: 'negative', state: 'partial' }] },
  ])
    assert({
      given: 'an incomplete or synthetic proof',
      should: 'refuse the claim',
      actual: transcriptProofProblems({ ...proof, ...changed }).length > 0,
      expected: true,
    });
});
