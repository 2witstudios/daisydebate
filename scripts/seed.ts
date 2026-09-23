/**
 * `bun db:seed`: the dev fixture (the agent users, their actors and one
 * waiting debate). Reference data every environment needs (the formats) is
 * not seed content: the migrations insert it (ADR 0038).
 */
import { SQL } from 'bun';
import {
  agentSeedDebate,
  agentSeedUsers,
  agentSeedVersion,
} from './agent-seed';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');

// jsonb values are passed as objects: Bun SQL JSON-encodes a pre-serialized
// string a second time, storing a jsonb string instead of an object.
const client = new SQL(url, { max: 1 });
try {
  await client.begin(async (transaction) => {
    for (const user of agentSeedUsers) {
      await transaction`
        insert into users (id, username)
        values (${user.userId}, ${user.username})
        on conflict (id) do update
        set username = excluded.username
      `;
      await transaction`
        insert into actors (id, kind, user_id)
        values (${user.actorId}, 'human', ${user.userId})
        on conflict (id) do update
        set kind = excluded.kind,
            user_id = excluded.user_id
      `;
    }

    await transaction`
      insert into debates (id, created_by_actor_id, resolution, format_id, snapshot, mode, phase, visibility)
      values (
        ${agentSeedDebate.debateId},
        ${agentSeedDebate.createdBy},
        ${agentSeedDebate.resolution},
        ${agentSeedDebate.format},
        ${agentSeedDebate.snapshot},
        ${agentSeedDebate.mode},
        ${agentSeedDebate.snapshot.phase},
        ${agentSeedDebate.visibility}
      )
      on conflict (id) do update
      set created_by_actor_id = excluded.created_by_actor_id,
          resolution = excluded.resolution,
          format_id = excluded.format_id,
          snapshot = excluded.snapshot,
          mode = excluded.mode,
          phase = excluded.phase,
          visibility = excluded.visibility,
          -- A progressed seed debate returns to waiting; the lifecycle CHECK
          -- requires its projections to return with it.
          started_at = null,
          completed_at = null,
          outcome = null
      `;

    await transaction`
        insert into seed_versions (seed_name, version)
        values ('agent', ${agentSeedVersion})
        on conflict (seed_name) do update
        set version = excluded.version,
            updated_at = case
              when seed_versions.version <> excluded.version then excluded.updated_at
              else seed_versions.updated_at
            end
      `;
  });
} finally {
  await client.close();
}

process.stdout.write(`Seed version: ${agentSeedVersion}\n`);
