import { createApp } from '../../server/app';
import { authTestEnv } from '../auth/auth-server.test-support';
/** Two app-bound suites exercise anonymous policy/vendor refusal without service calls. */
export function createMessagingUnitApp(
  input: Pick<
    Parameters<typeof createApp>[0],
    'clock' | 'ids' | 'messagingPolicy' | 'messagingFiles'
  >,
) {
  return createApp({
    ...input,
    env: {
      ...authTestEnv,
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://unit:unit@127.0.0.1:1/unit',
      REDIS_URL: 'redis://127.0.0.1:1',
      REDIS_NAMESPACE: 'messaging-route-unit',
      LOG_LEVEL: 'silent',
    },
    fetch: async () => {
      throw new Error('Unexpected outbound request');
    },
  });
}
