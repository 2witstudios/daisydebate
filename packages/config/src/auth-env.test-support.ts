/** The minimal valid `readAuthConfig` environment, shared by `index.test.ts` and `ops-probe-token.test.ts`. */
export const authEnv = {
  NODE_ENV: 'development',
  BETTER_AUTH_SECRET:
    '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  PUBLIC_APP_URL: 'https://daisy.example.com',
  RESEND_API_KEY: 're_test_000000000000000000000000',
  AUTH_EMAIL_FROM: 'Daisy <no-reply@daisy.example.com>',
};
