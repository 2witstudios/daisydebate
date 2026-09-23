import type { SQL } from 'bun';

/** Proves LISTEN works without holding a subscription open (ADR 0031 readiness). */
export async function probeListen(client: SQL): Promise<void> {
  const subscription = await client.listen(
    'daisy_realtime_readiness_probe',
    () => {},
  );
  await subscription.unlisten();
}
