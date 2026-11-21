import type { SQL } from 'bun';

/** Convert a stored fixture so its ranking-dependent consumers can be tested. */
export async function pinRankedFixturePool(
  client: SQL,
  roundId: string,
  preset?: { readonly formatId: string; readonly version: number },
): Promise<string | null> {
  return client.begin(async (tx) => {
    const [pool] = await tx`select l.id as lobby_id, l.owner_organization_id,
      d.id as ladder_id, s.id as season_id
      from rounds r
      left join rooms rm on rm.id=r.room_id
      join lobbies l on l.id=coalesce(rm.lobby_id, (
        select candidate.id from lobbies candidate
        join organizations o on o.id=candidate.owner_organization_id
        where o.official and candidate.kind='standing' and candidate.age_rule='adults'
        order by candidate.created_at,candidate.id limit 1
      ))
      join ladders d on d.lobby_id=l.id
      left join seasons s on s.lobby_id=l.id and s.status='active'
      where r.id=${roundId}
      order by d.created_at,d.id limit 1`;
    if (!pool) throw new Error('Ranked fixture pool is missing');
    const archive = pool.season_id ? null : roundId;
    if (archive)
      await tx`insert into seasons(id,lobby_id,organization_id,name,starts_at,ends_at,status)
        values (${archive},${pool.lobby_id},${pool.owner_organization_id},
          'Archived fixture','2000-01-01','2000-01-02','closed')`;
    await tx`alter table rounds disable trigger rounds_rating_pool_immutable`;
    await tx`update rounds set competition_type='ranked',
      format_id=${preset?.formatId ?? 'freestyle'},format_version=1,preset_version=${preset?.version ?? 1},
      ladder_id=${pool.ladder_id},rating_lobby_id=${pool.lobby_id},season_id=${pool.season_id ?? archive}
      where id=${roundId}`;
    await tx`set constraints all immediate`;
    await tx`alter table rounds enable trigger rounds_rating_pool_immutable`;
    return archive;
  });
}
