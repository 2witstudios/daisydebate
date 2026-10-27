export const STAGING_TRANSCRIPT_ORIGIN = 'https://daisy-debate-staging.fly.dev';

/** Every guard runs before fixture writes; the server's database name is checked separately. */
export function requireStagingTranscriptTarget(input: {
  readonly origin: string | undefined;
  readonly app: string | undefined;
  readonly commit: string | undefined;
  readonly expectedCommit: string | undefined;
}) {
  if (
    input.origin !== STAGING_TRANSCRIPT_ORIGIN ||
    input.app !== 'daisy-debate-staging' ||
    !/^[0-9a-f]{40}$/.test(input.expectedCommit ?? '') ||
    input.commit !== input.expectedCommit
  )
    throw new Error('Staging transcript proof target mismatch');
}

export function stagingTranscriptConfiguration(
  env: Readonly<Record<string, string | undefined>>,
  expectedCommit: string | undefined,
) {
  requireStagingTranscriptTarget({
    origin: env.PUBLIC_APP_URL,
    app: env.FLY_APP_NAME,
    commit: env.GIT_COMMIT,
    expectedCommit,
  });
  const url = env.DATABASE_URL;
  const secret = env.BETTER_AUTH_SECRET;
  if (!url || !secret || !env.OPENROUTER_API_KEY)
    throw new Error('Staging proof configuration missing');
  if (new URL(url).pathname !== '/daisy_debate_staging')
    throw new Error('Staging database URL mismatch');
  return { url, secret };
}

export type TranscriptProofStream = {
  readonly role: string;
  readonly state: string;
  readonly chunks: number;
  readonly observedMs: number;
  readonly publishedMs: number;
  readonly realSpeech: boolean;
  readonly realTts: boolean;
  readonly realStt: boolean;
};
export function transcriptProofProblems(input: {
  readonly completeness: string | null;
  readonly decisive: boolean;
  readonly aiBallot: boolean;
  readonly streams: readonly TranscriptProofStream[];
}) {
  const problems: string[] = [];
  if (input.completeness !== 'complete') problems.push('freeze');
  if (!input.decisive || !input.aiBallot) problems.push('judging');
  const roles = input.streams.map((stream) => stream.role).sort();
  if (roles.join(',') !== 'affirmative,negative') problems.push('seats');
  for (const stream of input.streams) {
    if (
      stream.state !== 'complete' ||
      stream.chunks < 1 ||
      stream.observedMs <= 0 ||
      stream.publishedMs <= 0
    )
      problems.push('capture');
    if (!stream.realSpeech || !stream.realTts || !stream.realStt)
      problems.push('provider');
  }
  return problems;
}
