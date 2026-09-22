import { SQL } from 'bun';
import { formatRulesSchema } from '@daisy/protocol';
import {
  agentSeedDebate,
  agentSeedUsers,
  agentSeedVersion,
} from './agent-seed';
import { formatSeedVersion, formatSeeds } from './format-seed';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');

// Validate before opening a connection: a bad rules value never reaches SQL.
const formats = formatSeeds.map((format) => ({
  ...format,
  rules: formatRulesSchema.parse(format.rules),
}));

const client = new SQL(url, { max: 1 });
try {
  await client.begin(async (transaction) => {
    for (const format of formats)
      await transaction`
        insert into formats (id, name, rules, ranked_eligible)
        values (
          ${format.id},
          ${format.name},
          ${JSON.stringify(format.rules)}::jsonb,
          ${format.rankedEligible}
        )
        on conflict (id) do update
        set name = excluded.name,
            rules = excluded.rules,
            ranked_eligible = excluded.ranked_eligible
      `;

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
      insert into debates (id, created_by, resolution, format, snapshot, mode, phase, visibility)
      values (
        ${agentSeedDebate.debateId},
        ${agentSeedDebate.createdBy},
        ${agentSeedDebate.resolution},
        ${agentSeedDebate.format},
        ${JSON.stringify(agentSeedDebate.snapshot)}::jsonb,
        ${agentSeedDebate.mode},
        ${agentSeedDebate.snapshot.phase},
        ${agentSeedDebate.visibility}
      )
      on conflict (id) do update
      set created_by = excluded.created_by,
          resolution = excluded.resolution,
          format = excluded.format,
          snapshot = excluded.snapshot,
          mode = excluded.mode,
          phase = excluded.phase,
          visibility = excluded.visibility
      `;

    for (const [seedName, version] of [
      ['formats', formatSeedVersion],
      ['agent', agentSeedVersion],
    ] as const)
      await transaction`
        insert into seed_versions (seed_name, version)
        values (${seedName}, ${version})
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

process.stdout.write(
  `Seed versions: ${formatSeedVersion}, ${agentSeedVersion}\n`,
);
