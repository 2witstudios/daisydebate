/** Minimal server environment for configuration boundary tests. */
export const env = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://user:secret@localhost:5432/daisy',
  REDIS_URL: 'redis://localhost:6379',
  PUBLIC_APP_URL: 'http://localhost:3000',
};
