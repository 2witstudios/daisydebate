import { virtualClock } from '@daisy/clock/testing';
import { createId } from '@paralleldrive/cuid2';
import { createDatabase } from './index';

export { fakeSql } from './scripted-bun-wire';

type SinkEvent = {
  event: string;
  fields: Record<string, unknown>;
  message: string;
};

/** A database whose server refuses connections, recording sink events. */
export const unreachableDatabase = () => {
  const events: SinkEvent[] = [];
  const database = createDatabase({
    url: 'postgresql://user:password@127.0.0.1:1/daisy',
    eventSink: (event, fields, message) =>
      events.push({ event, fields, message }),
    nextActorId: createId,
    waits: virtualClock(),
  });
  return { database, events };
};
