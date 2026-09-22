import { RedisClient } from 'bun';

/** A raw client for assertions our own package's API cannot make: PTTL, EXISTS, and direct key manipulation. */
export async function rawClient(url: string) {
  const client = new RedisClient(url);
  await client.connect();
  return client;
}
