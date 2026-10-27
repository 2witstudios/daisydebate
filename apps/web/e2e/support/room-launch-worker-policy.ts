/**
 * Explicit local proof capacity for the launch browser server's bot and AI
 * judging workers, each under its own policy, sharing the competitive
 * provider budget. The provider key still comes only from
 * E2E_OPENROUTER_API_KEY; the placeholder key leaves every model call a
 * recorded provider failure.
 */
export const launchWorkerEnv = {
  COMPETITIVE_PROVIDER_CONCURRENCY: '2',
  ROUND_BOT_WORKER_POLICY: JSON.stringify({
    maxControllers: 4,
    scanBatch: 16,
    scanMs: 250,
    leaseMs: 15000,
    renewMs: 3000,
    callTimeoutMs: 30000,
    models: {
      speech: 'anthropic/claude-sonnet-5.5',
      cross_ex: 'anthropic/claude-sonnet-5.5',
      tts: 'deepgram/aura-2',
    },
  }),
  ROUND_JUDGING_POLICY: JSON.stringify({
    scanBatch: 16,
    scanMs: 250,
    leaseMs: 15000,
    renewMs: 3000,
    callTimeoutMs: 30000,
    model: 'anthropic/claude-sonnet-5.5',
  }),
};
