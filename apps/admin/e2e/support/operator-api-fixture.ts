/**
 * The browser journey's operator API settings, shared by the stub server and
 * the admin server under test. Loopback only; the key exists for this suite.
 */
export const e2eOperatorApi = {
  port: 4801,
  keyId: 'admine2e',
  key: Buffer.from(new Uint8Array(32).fill(42)).toString('base64url'),
  audience: 'daisy-web:local',
} as const;

export const e2eOperatorEnv = {
  OPERATOR_API_URL: `http://localhost:${e2eOperatorApi.port}`,
  OPERATOR_API_KEY_ID: e2eOperatorApi.keyId,
  OPERATOR_API_KEY: e2eOperatorApi.key,
  OPERATOR_AUDIENCE: e2eOperatorApi.audience,
};

export const e2ePendingAccount = {
  userId: 'pendingplayer00000000001',
  username: 'pending-player',
  accessState: 'pending',
  accessRevision: 1,
  requestedAt: '2026-10-25T09:00:00.123456Z',
  decidedAt: null,
} as const;
