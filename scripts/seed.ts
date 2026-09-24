/**
 * `bun db:seed`: the dev fixture (the agent users, their actors and one
 * waiting debate), written only through `@daisy/db`'s `applyDevSeed`
 * adapter operation (ISSUE-8 AC4). Reference data every environment needs
 * (the formats) is not seed content: the migrations insert it (ADR 0038).
 */
import { applyDevSeed } from '@daisy/db/dev-seed';
import {
  agentSeedDebate,
  agentSeedUsers,
  agentSeedVersion,
} from './agent-seed';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');

await applyDevSeed({
  url,
  seed: {
    name: 'agent',
    version: agentSeedVersion,
    people: agentSeedUsers,
    debate: {
      id: agentSeedDebate.debateId,
      createdBy: agentSeedDebate.createdBy,
      resolution: agentSeedDebate.resolution,
      format: agentSeedDebate.format,
      snapshot: agentSeedDebate.snapshot,
      mode: agentSeedDebate.mode,
      visibility: agentSeedDebate.visibility,
    },
  },
});

process.stdout.write(`Seed version: ${agentSeedVersion}\n`);
