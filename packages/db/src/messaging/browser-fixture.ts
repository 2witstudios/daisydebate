import type { SQL } from 'bun';
import { idSchema } from '@daisy/protocol';
type BrowserAccount = { readonly userId: string; readonly username: string };
/** Test-only: binds accounts created by actual HTTP signup before injecting isolated age inputs. */
export async function seedMessagingBrowserAccounts(
  client: SQL,
  accounts: readonly BrowserAccount[],
  now: string,
) {
  accounts.forEach((account) => idSchema.parse(account.userId));
  if (!Number.isFinite(Date.parse(now)))
    throw new Error('Invalid browser fixture instant');
  return client.begin(async (tx) => {
    const result: Array<BrowserAccount & { actorId: string }> = [];
    for (const account of [...accounts].sort((a, b) =>
      a.userId.localeCompare(b.userId),
    )) {
      const [row] =
        await tx`select a.id as "actorId" from users u join actors a on a.user_id=u.id where u.id=${account.userId} and u.username=${account.username} and u.email_verified and u.deleted_at is null and a.kind='human' for update of u`;
      const actorId = idSchema.safeParse(row?.actorId);
      if (!actorId.success)
        throw new Error('Messaging browser account ownership refused');
      result.push({ ...account, actorId: actorId.data });
      await tx`insert into account_age(user_id,birth_month,version,recorded_at) values(${account.userId},'2000-01',1,${now}::timestamptz)`;
    }
    return result;
  });
}
/** Remove only the declared test channel/age rows before the shared account fixture disposes its own signup resources. */
export async function cleanupMessagingBrowserData(
  client: SQL,
  accounts: readonly (BrowserAccount & { actorId: string })[],
  channels: readonly string[],
) {
  const channelIds = [...channels];
  const actors = accounts.map((account) => idSchema.parse(account.actorId));
  channels.forEach((channelId) => idSchema.parse(channelId));
  await client.begin(async (tx) => {
    const userIds = accounts.map((account) => account.userId).sort();
    await tx`select id from users where id=any(${tx.array(userIds, 'text')}::text[]) order by id for update`;
    await tx`select low_actor_id from messaging_contact_pairs where low_actor_id=any(${tx.array(actors, 'text')}::text[]) and high_actor_id=any(${tx.array(actors, 'text')}::text[]) order by low_actor_id,high_actor_id for update`;
    await tx`select id from messaging_channels where id=any(${tx.array(channelIds, 'text')}::text[]) order by id for update`;
    const [foreign] =
      await tx`select exists(select 1 from messaging_channels c where c.id=any(${tx.array(channelIds, 'text')}::text[]) and not ((c.kind='dm' and exists(select 1 from messaging_dm_pairs p where p.channel_id=c.id and p.low_actor_id=any(${tx.array(actors, 'text')}::text[]) and p.high_actor_id=any(${tx.array(actors, 'text')}::text[]))) or (c.kind='private_group' and exists(select 1 from messaging_social_commands s where s.result_channel_id=c.id and s.kind='group.create' and s.actor_id=any(${tx.array(actors, 'text')}::text[])))))
      or exists(select 1 from messaging_group_grants where channel_id=any(${tx.array(channelIds, 'text')}::text[]) and not(actor_id=any(${tx.array(actors, 'text')}::text[])))
      or exists(select 1 from messaging_group_invitations where channel_id=any(${tx.array(channelIds, 'text')}::text[]) and (not(invitee_actor_id=any(${tx.array(actors, 'text')}::text[])) or not(invited_by_actor_id=any(${tx.array(actors, 'text')}::text[]))))
      or exists(select 1 from messaging_messages where channel_id=any(${tx.array(channelIds, 'text')}::text[]) and not(author_actor_id=any(${tx.array(actors, 'text')}::text[])))
      or exists(select 1 from messaging_files where channel_id=any(${tx.array(channelIds, 'text')}::text[]) and not(owner_actor_id=any(${tx.array(actors, 'text')}::text[])))
      or exists(select 1 from messaging_dm_pairs where channel_id=any(${tx.array(channelIds, 'text')}::text[]) and (not(low_actor_id=any(${tx.array(actors, 'text')}::text[])) or not(high_actor_id=any(${tx.array(actors, 'text')}::text[]))))
      or exists(select 1 from messaging_social_commands where result_channel_id=any(${tx.array(channelIds, 'text')}::text[]) and not(actor_id=any(${tx.array(actors, 'text')}::text[]))) as present`;
    if (foreign?.present !== false)
      throw new Error('Messaging browser cleanup foreign contribution refused');
    await tx`delete from messaging_social_commands where actor_id=any(${tx.array(actors, 'text')}::text[])`;
    await tx`delete from messaging_files where channel_id=any(${tx.array(channelIds, 'text')}::text[]) and owner_actor_id=any(${tx.array(actors, 'text')}::text[])`;
    await tx`delete from messaging_channels where id=any(${tx.array(channelIds, 'text')}::text[])`;
    await tx`delete from messaging_contact_pairs where low_actor_id=any(${tx.array(actors, 'text')}::text[]) and high_actor_id=any(${tx.array(actors, 'text')}::text[])`;
    await tx`delete from outbox where topic=any(${tx.array(
      channels.map((id) => `channel:${id}`),
      'text',
    )}::text[])`;
    await tx`delete from account_age where user_id=any(${tx.array(userIds, 'text')}::text[])`;
  });
}
