import { SQL } from 'bun';
import {
  agentSeedDebate,
  agentSeedUsers,
  agentSeedVersion,
} from './agent-seed';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');

const client = new SQL(url, { max: 1 });
try {
  await client.begin(async (transaction) => {
    for (const user of agentSeedUsers)
      await transaction`
        insert into users (id, username)
        values (${user.userId}::uuid, ${user.username})
        on conflict (id) do update
        set username = excluded.username
      `;

    await transaction`
      insert into debates (id, created_by, resolution, format, snapshot)
      values (
        ${agentSeedDebate.debateId}::uuid,
        ${agentSeedDebate.createdBy}::uuid,
        ${agentSeedDebate.resolution},
        ${agentSeedDebate.format},
        ${JSON.stringify(agentSeedDebate.snapshot)}::jsonb
      )
      on conflict (id) do update
      set created_by = excluded.created_by,
          resolution = excluded.resolution,
          format = excluded.format,
          snapshot = excluded.snapshot
    `;
  });
} finally {
  await client.close();
}

process.stdout.write(`Seed version: ${agentSeedVersion}\n`);
