import { readServerConfig } from './index';

/** Minimal server environment for configuration boundary tests. */
export const env = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://user:secret@localhost:5432/daisy',
  REDIS_URL: 'redis://localhost:6379',
  PUBLIC_APP_URL: 'http://localhost:3000',
};

/** The refusal prefix `readServerConfig` names for one JSON policy override, or 'accepted'. */
export const policyRefusal =
  (base: Record<string, string>, name: string) => (value: string) => {
    try {
      readServerConfig({ ...base, [name]: value });
      return 'accepted';
    } catch (error) {
      return (error as Error).message.split(':').slice(0, 2).join(':').trim();
    }
  };
