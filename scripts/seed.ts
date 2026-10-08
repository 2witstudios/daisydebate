/**
 * `bun db:seed`: the dev fixture (the agent users, their actors and one
 * scheduled practice round), written only through `@daisy/db`'s
 * `applyDevSeed` adapter operation (ISSUE-8 AC4). Reference data every
 * environment needs (the formats and bots) is not seed content: the
 * migrations insert it (ADR 0038).
 */
import { applyDevSeed } from '@daisy/db/dev-seed';
import { agentSeedRound, agentSeedUsers, agentSeedVersion } from './agent-seed';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');

await applyDevSeed({
  url,
  seed: {
    name: 'agent',
    version: agentSeedVersion,
    people: agentSeedUsers,
    round: agentSeedRound,
  },
});

process.stdout.write(`Seed version: ${agentSeedVersion}\n`);
