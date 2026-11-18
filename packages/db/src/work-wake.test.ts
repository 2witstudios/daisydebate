import type { SQL } from 'bun';
import { PgDialect } from 'drizzle-orm/pg-core';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  notifyWork,
  subscribeWorkWakes,
  WORK_CHANNEL,
  type WorkKind,
} from './work-wake';

setupRitewayBun();

const fakeClient = () => {
  let notify: (payload: string) => void = () => {};
  let listened: () => void = () => {};
  let channel = '';
  const client = {
    async listen(
      name: string,
      onNotify: (payload: string) => void,
      onListen: () => void,
    ) {
      channel = name;
      notify = onNotify;
      listened = onListen;
      return { unlisten: async () => undefined };
    },
  } as unknown as SQL;
  return {
    client,
    notify: (payload: string) => notify(payload),
    listened: () => listened(),
    channel: () => channel,
  };
};

test('work wakes pass known kinds and drop anything else', async () => {
  const fake = fakeClient();
  const kinds: WorkKind[] = [];
  let listens = 0;
  const subscription = await subscribeWorkWakes(fake.client, {
    onNotify: (kind) => kinds.push(kind),
    onListen: () => {
      listens += 1;
    },
  });
  fake.listened();
  for (const payload of ['judging', 'round', 'drop table', '', 'analysis'])
    fake.notify(payload);
  await subscription.unlisten();
  fake.notify('round');
  fake.listened();
  assert({
    given: 'notifications on the work channel, then an unlisten',
    should: 'deliver only known kinds, and nothing once closed',
    actual: { channel: fake.channel(), kinds, listens },
    expected: {
      channel: WORK_CHANNEL,
      kinds: ['judging', 'round', 'analysis'],
      listens: 1,
    },
  });
});

test('a wake is sent on the channel the listener hears', async () => {
  const sent: unknown[][] = [];
  await notifyWork(
    {
      execute: async (query) => {
        sent.push(new PgDialect().sqlToQuery(query).params);
      },
    },
    'judging',
  );
  const fake = fakeClient();
  await subscribeWorkWakes(fake.client, {
    onNotify: () => {},
    onListen: () => {},
  });
  assert({
    given: 'a judging wake and a listener',
    should: 'notify and listen on the same channel',
    actual: { notifies: sent, listens: fake.channel() },
    expected: { notifies: [[WORK_CHANNEL, 'judging']], listens: WORK_CHANNEL },
  });
});
