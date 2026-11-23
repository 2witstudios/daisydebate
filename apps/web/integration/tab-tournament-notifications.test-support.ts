import { openWebDatabase, type WebDatabase } from '../src/server/database';
import { hostWaits } from '@daisy/worker/host';
import {
  notificationPreferencesSchema,
  notificationShellSchema,
} from '@daisy/protocol/notifications';
import { createId } from '@paralleldrive/cuid2';
import { SQL } from 'bun';
import { assert } from 'riteway/bun';
import { readNotificationItems } from '../src/features/notifications/read-notifications';
import type { World } from './tab-tournament.test-support';

/** The real notification reader, running as the web role on the script's committed database. */
export async function withTournamentNotificationReader<T>(
  world: World,
  work: (store: WebDatabase) => Promise<T>,
): Promise<T> {
  if (!world.runtimeDatabaseUrl)
    throw new Error(
      'Notification proof needs the committed tournament database',
    );
  const client = new SQL(world.runtimeDatabaseUrl, {
    max: 3,
    connection: { role: 'daisy_web' },
  });
  const store = openWebDatabase({
    waits: hostWaits,
    url: world.runtimeDatabaseUrl,
    client,
    nextActorId: createId,
  });
  try {
    const [role] = await client`select current_user as role`;
    if (role?.role !== 'daisy_web')
      throw new Error('Notification proof must use runtime authority');
    return await work(store);
  } finally {
    await store.close();
    await client.close();
  }
}

/** Stage12 reads the notifications actually produced by the preceding tournament commands. */
export async function notificationsStage(world: World): Promise<void> {
  const lobbyId = world.made.get('tournament-lobby')!;
  const notices = await world.sql<
    {
      kind: string;
      user_id: string;
      fixture_id: string;
      tab_command_id: string;
    }[]
  >`
    select kind,user_id,fixture_id,tab_command_id from notifications where notification_lobby_id=${lobbyId}`;
  const kinds = new Set(notices.map((row) => row.kind));
  assert({
    given:
      'the real published, officiated and certified tournament from the preceding stages',
    should:
      'already have emitted assignments, replacements, draw changes, Room availability and result releases',
    actual: [
      'judge_assigned',
      'judge_replaced',
      'tournament_draw_changed',
      'tournament_room_ready',
      'tournament_results_released',
    ].every((kind) => kinds.has(kind)),
    expected: true,
  });
  const [duplicates] = await world.sql`select count(*)::int n from (
    select user_id,kind,fixture_id,tab_command_id from notifications where notification_lobby_id=${lobbyId}
    group by user_id,kind,fixture_id,tab_command_id having count(*)>1) d`;
  const [signals] =
    await world.sql`select count(*)::int n from notifications n where notification_lobby_id=${lobbyId}
    and (select count(*) from outbox o where o.kind='user.notification-delivered' and o.payload->'ids' ? n.id)<>1`;
  assert({
    given:
      'the genuine publication and certification retries and confirmed original judge command',
    should:
      'keep one inbox row and one content-free signal per recipient and command subject',
    actual: [duplicates!.n, signals!.n],
    expected: [0, 0],
  });
  await withTournamentNotificationReader(world, async (store) => {
    const input = {
      query: { unreadOnly: false, after: null },
      now: new Date().toISOString(),
    };
    const competitor = world.bots['Debater 1']!;
    const result = await readNotificationItems(store, {
      ...input,
      userId: competitor.userId,
    });
    const unrelated = await readNotificationItems(store, {
      ...input,
      userId: world.bots.Coach!.userId,
    });
    assert({
      given:
        'the actual participant and an unrelated account reading the existing Notifications feature',
      should:
        'show the participant a protected results link without scores, and give the unrelated account no tournament notices',
      actual: [
        result.items.some(
          (item) =>
            item.text === 'Your tournament results have been released.' &&
            item.href.startsWith('/tournaments/') &&
            item.href.includes('/standings?event='),
        ),
        unrelated.items.length,
      ],
      expected: [true, 0],
    });
    const choices = await store.readNotificationPreferences({
      userId: competitor.userId,
    });
    const setPreferences = async (next: typeof choices) => {
      if (!world.http) {
        await store.writeNotificationPreferences({
          userId: competitor.userId,
          choices: next,
        });
        return;
      }
      const response = await world.http(
        competitor,
        '/api/notifications/preferences',
        notificationPreferencesSchema.parse({ version: 2, choices: next }),
      );
      if (!response.ok)
        throw new Error(`Notification preferences: HTTP ${response.status}`);
    };
    await setPreferences({
      ...choices,
      tournament_results_released: { in_app: false },
    });
    const hidden = await readNotificationItems(store, {
      ...input,
      userId: competitor.userId,
    });
    await setPreferences(choices);
    assert({
      given: 'the existing saved preference switches for the actual competitor',
      should:
        'suppress the released-results delivery and its unread count without deleting notification truth',
      actual: [
        hidden.items.some(
          (item) => item.text === 'Your tournament results have been released.',
        ),
        hidden.unread < result.unread,
      ],
      expected: [false, true],
    });
    // The shell's read (badge and toasts) asks for unread rows only, and
    // Tab's standing then visits only lobbies with an unread row (NTF-15).
    const unreadOnly = (now: string) =>
      readNotificationItems(store, {
        query: { unreadOnly: true, after: null },
        now,
        userId: competitor.userId,
      });
    const released = (items: readonly { readonly text: string }[]) =>
      items.some(
        (item) => item.text === 'Your tournament results have been released.',
      );
    const unreadBefore = await unreadOnly(new Date().toISOString());
    if (world.http) {
      const read = await world.http(competitor, '/api/notifications/read', {
        version: 1,
        kind: 'all',
      });
      if (!read.ok)
        throw new Error(`Mark notifications read: HTTP ${read.status}`);
      const shell = await world.http(competitor, '/api/notifications/shell');
      if (!shell.ok)
        throw new Error(`Notification shell: HTTP ${shell.status}`);
      const badge = notificationShellSchema.parse(await shell.json());
      assert({
        given: 'the member marked all notices read through the account route',
        should:
          'clear the unread badge and recent notices through the shell read',
        actual: [badge.unread, badge.recent.length],
        expected: [0, 0],
      });
    } else {
      await store.markNotificationsRead({
        userId: competitor.userId,
        notificationIds: 'all',
        at: new Date().toISOString(),
      });
    }
    const unreadAfter = await unreadOnly(new Date().toISOString());
    const everything = await readNotificationItems(store, {
      ...input,
      now: new Date().toISOString(),
      userId: competitor.userId,
    });
    assert({
      given:
        'the competitor’s unread-only read (the shell’s), before and after marking everything read',
      should:
        'list and count the unread results notice, then show and count no tournament notice while the full read still holds it',
      actual: [
        released(unreadBefore.items),
        unreadBefore.unread > 0,
        released(unreadAfter.items),
        unreadAfter.unread,
        released(everything.items),
      ],
      expected: [true, true, false, 0, true],
    });
  });
}
