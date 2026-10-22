/**
 * Explicit local proof capacity for the launch browser server's shared bot
 * workers. The provider key still comes only from E2E_OPENROUTER_API_KEY; the
 * placeholder key leaves every model call a recorded provider failure.
 */
export const launchWorkerPolicy = JSON.stringify({
  maxControllers: 4,
  providerConcurrency: 2,
  scanBatch: 16,
  scanMs: 250,
  leaseMs: 15000,
  renewMs: 3000,
  callTimeoutMs: 30000,
  models: {
    speech: 'anthropic/claude-sonnet-5.5',
    cross_ex: 'anthropic/claude-sonnet-5.5',
    judge: 'anthropic/claude-sonnet-5.5',
    tts: 'deepgram/aura-2',
  },
});
