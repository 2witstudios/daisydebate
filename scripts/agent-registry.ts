/**
 * Who spawned each pu agent, and as what (ADR 0035). Records live in the
 * project root's .pu/daisy/agents, outside every worktree: the parent's
 * `bun agent:spawn` writes them, the guard refuses agent writes there, and
 * loop control trusts only them, never a file the child could edit.
 */
import { join } from 'node:path';
import type { Role } from './agent-spawn-model';

export type AgentRecord = {
  /** The spawning agent; null when the owner spawned it. */
  readonly parent: string | null;
  readonly role: Role;
  readonly worktree: string;
};

export const REGISTRY_DIR = '.pu/daisy/agents';

export function recordPath(projectRoot: string, agentId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(agentId))
    throw new Error(`Invalid agent id "${agentId}"`);
  return join(projectRoot, REGISTRY_DIR, `${agentId}.json`);
}

export const serializeRecord = (record: AgentRecord): string =>
  `${JSON.stringify(record)}\n`;

export function parseRecord(text: string): AgentRecord | undefined {
  try {
    const value = JSON.parse(text) as Partial<AgentRecord>;
    const parentOk = value.parent === null || typeof value.parent === 'string';
    const roleOk = value.role === 'builder' || value.role === 'reviewer';
    return parentOk && roleOk && typeof value.worktree === 'string'
      ? {
          parent: value.parent ?? null,
          role: value.role as Role,
          worktree: value.worktree,
        }
      : undefined;
  } catch {
    return undefined;
  }
}
