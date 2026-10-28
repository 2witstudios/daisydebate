import type { RedisTransport } from './transport';

/**
 * Runs one Redis operation after connecting, reporting any failure by its
 * operation name only (never the key or value) before rethrowing.
 */
export const reportedOperation =
  (input: {
    readonly client: RedisTransport;
    readonly reportFailure: (operation: string) => void;
  }) =>
  async <T>(operation: string, work: () => Promise<T>): Promise<T> => {
    try {
      await input.client.connect();
      return await work();
    } catch (error) {
      input.reportFailure(operation);
      throw error;
    }
  };
