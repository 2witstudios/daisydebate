import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';

/** Give a browser host a league, then open registration on the tournament made in the UI. */
if (import.meta.main) {
  const target = process.env.E2E_DATABASE_URL!;
  if (!new URL(target).pathname.endsWith('_e2e'))
    throw new Error('This seed runs only against an E2E database');
  const [step, argument] = [Bun.argv[2], Bun.argv[3]];
  const sql = new SQL(target, { max: 1 });
  try {
    await sql.begin(async (tx) => {
      if (step === 'league') {
        const [host] =
          await tx`select id from users where username=${argument}`;
        if (!host) throw new Error('The league owner does not exist');
        const leagueId = createId();
        const youthId = createId();
        const seasonId = createId();
        const handle = `eligibility-${leagueId}`;
        await tx`select set_config('daisy.organization_scope', ${leagueId}, true)`;
        await tx`insert into organizations (id, kind, owner_user_id, handle, name)
          values (${leagueId}, 'league', ${host.id}, ${handle}, 'League Cup Hosts')`;
        for (const lobby of [
          { id: youthId, name: 'League Youth', ageRule: 'under-18' },
          { id: createId(), name: 'League Adults', ageRule: 'adults' },
        ]) {
          await tx`select set_config('daisy.lobby_scope', ${lobby.id}, true)`;
          await tx`insert into lobbies (id, kind, owner_organization_id, handle, name, age_rule)
            values (${lobby.id}, 'standing', ${leagueId}, ${lobby.id}, ${lobby.name}, ${lobby.ageRule})`;
        }
        await tx`select set_config('daisy.lobby_scope', ${youthId}, true)`;
        await tx`insert into seasons (id, organization_id, lobby_id, name, starts_at, status)
          values (${seasonId}, ${leagueId}, ${youthId}, 'Spring', now()-interval '1 day', 'active')`;
        await tx`insert into season_standing_rules (season_id, organization_id, counting, rule)
          values (${seasonId}, ${leagueId}, 'sanction', '{}'::jsonb)`;
        await tx`insert into templates (id, organization_id, name, format_id, format_version)
          values (${createId()}, ${leagueId}, 'Freestyle series', 'freestyle', 1)`;
        process.stdout.write(handle);
      } else if (step === 'registration') {
        const [lobby] =
          await tx`select id from lobbies where handle=${argument}`;
        if (!lobby)
          throw new Error('The browser did not create the tournament');
        await tx`select set_config('daisy.lobby_scope', ${lobby.id}, true)`;
        const [event] =
          await tx`select id from events where lobby_id=${lobby.id}`;
        if (!event) throw new Error('The browser did not create an event');
        const stageId = createId();
        await tx`insert into stages (id, lobby_id, event_id, kind, sequence, place, timing)
          values (${stageId}, ${lobby.id}, ${event.id}, 'preliminary', 1, 'online', 'live')`;
        await tx`insert into tab_rounds (id, lobby_id, event_id, stage_id, number, name)
          values (${createId()}, ${lobby.id}, ${event.id}, ${stageId}, 1, 'Round 1')`;
        await tx`update tournaments set status='open' where lobby_id=${lobby.id}`;
        await tx`insert into settings (id, lobby_id, scope_kind, key, hold, value)
          values (${createId()}, ${lobby.id}, 'lobby', 'audience.posting', 'default',
          ${{ participants: 'at_once', competitors: 'at_once', responsible_adults: 'at_once', link: 'at_once', public: 'at_once' }})`;
        await tx`insert into settings (id, lobby_id, event_id, scope_kind, key, hold, value)
          values
            (${createId()}, ${lobby.id}, ${event.id}, 'event', 'entry.registration', 'default', ${{ state: 'open' }}),
            (${createId()}, ${lobby.id}, ${event.id}, 'event', 'entry.approval', 'default', ${{ value: 'automatic' }})`;
      } else {
        throw new Error('Unknown tournament eligibility seed step');
      }
    });
  } finally {
    await sql.close();
  }
}
