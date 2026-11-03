import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import {
  claimRecordingJob,
  deferRecordingRun,
  finishRecordingRun,
  renewRecordingJob,
} from './recording-processing-operations';

/**
 * The processing worker's one database credential: its job table only. It
 * cannot read a Recording or a Round, so nothing it does can make a Recording
 * ready or reach the debate.
 */
export const createRecordingWorkerStore = (url: string) => {
  const client = new SQL(url, { max: 2 });
  const database = drizzle({ client });
  return {
    claim: (input: Parameters<typeof claimRecordingJob>[1]) =>
      database.transaction((tx) => claimRecordingJob(tx, input)),
    renew: (input: Parameters<typeof renewRecordingJob>[1]) =>
      renewRecordingJob(database, input),
    finish: (input: Parameters<typeof finishRecordingRun>[1]) =>
      finishRecordingRun(database, input),
    defer: (input: Parameters<typeof deferRecordingRun>[1]) =>
      deferRecordingRun(database, input),
    close: () => client.close(),
  };
};
