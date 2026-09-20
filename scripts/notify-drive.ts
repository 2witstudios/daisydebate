#!/usr/bin/env bun
import { createHmac } from 'node:crypto';
import type { DocumentationEvent } from './docs-pipeline';

const TASK_ID_PATTERN = /\b[A-Z]{2,6}-\d+(?:\.\d+)?\b/g;

export function extractTaskIds(text: string): string[] {
  return [...new Set(text.match(TASK_ID_PATTERN) ?? [])];
}

export function signPayload(
  secret: string,
  timestampSeconds: number,
  rawBody: string,
): string {
  const message = `v0:${timestampSeconds}:${rawBody}`;
  return 'v0=' + createHmac('sha256', secret).update(message).digest('hex');
}

function taskList(taskIds: string[]): string {
  return taskIds.length > 0
    ? `Tasks: ${taskIds.join(', ')}`
    : 'Tasks: none referenced';
}

export function composeIncidentMessage(input: {
  ref: string;
  sha: string;
  runUrl: string;
  taskIds: string[];
}): string {
  return [
    `🔴 CI failed — daisydebate@${input.ref}`,
    input.runUrl,
    `commit ${input.sha}`,
    taskList(input.taskIds),
  ].join('\n');
}

export function composeMergeMessage(input: {
  pr: number;
  title: string;
  url: string;
  sha: string;
  base: string;
  taskIds: string[];
}): string {
  return [
    `✅ Merged #${input.pr} — ${input.title}`,
    input.url,
    `${input.sha} → ${input.base}`,
    taskList(input.taskIds),
  ].join('\n');
}

export const CHANNELS = [
  'standup',
  'incidents',
  'sprint-room',
  'epic-updates',
] as const;
type Channel = (typeof CHANNELS)[number];

const CHANNEL_ENV: Record<Channel, { url: string; secret: string }> = {
  standup: {
    url: 'PAGESPACE_STANDUP_WEBHOOK_URL',
    secret: 'PAGESPACE_STANDUP_WEBHOOK_SECRET',
  },
  incidents: {
    url: 'PAGESPACE_INCIDENTS_WEBHOOK_URL',
    secret: 'PAGESPACE_INCIDENTS_WEBHOOK_SECRET',
  },
  'sprint-room': {
    url: 'PAGESPACE_SPRINT_ROOM_WEBHOOK_URL',
    secret: 'PAGESPACE_SPRINT_ROOM_WEBHOOK_SECRET',
  },
  'epic-updates': {
    url: 'PAGESPACE_EPIC_UPDATES_WEBHOOK_URL',
    secret: 'PAGESPACE_EPIC_UPDATES_WEBHOOK_SECRET',
  },
};

export async function postToDrive(
  channel: Channel,
  content: string,
): Promise<void> {
  const url = process.env[CHANNEL_ENV[channel].url];
  const secret = process.env[CHANNEL_ENV[channel].secret];
  if (!url || !secret) {
    throw new Error(
      `Missing ${CHANNEL_ENV[channel].url} or ${CHANNEL_ENV[channel].secret}`,
    );
  }
  const rawBody = JSON.stringify({ content, username: 'Daisy CI' });
  const timestampSeconds = Math.floor(Date.now() / 1000);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-pagespace-timestamp': String(timestampSeconds),
      'x-pagespace-signature': signPayload(secret, timestampSeconds, rawBody),
    },
    body: rawBody,
  });
  if (!response.ok) {
    throw new Error(
      `Webhook ${channel} responded ${response.status}: ${await response.text()}`,
    );
  }
}

export async function postDocumentationEvent(
  event: DocumentationEvent,
): Promise<void> {
  const webhookUrl = process.env.PAGESPACE_DOCUMENTATION_AGENT_WEBHOOK_URL;
  const secret = process.env.PAGESPACE_DOCUMENTATION_AGENT_WEBHOOK_SECRET;
  if (!webhookUrl || !secret) {
    throw new Error(
      'Missing PAGESPACE_DOCUMENTATION_AGENT_WEBHOOK_URL or PAGESPACE_DOCUMENTATION_AGENT_WEBHOOK_SECRET',
    );
  }
  const url = new URL(webhookUrl);
  if (url.protocol !== 'https:') {
    throw new Error(
      'PAGESPACE_DOCUMENTATION_AGENT_WEBHOOK_URL must use https to protect the signed event',
    );
  }
  const rawBody = JSON.stringify({
    event,
    username: 'Daisy Documentation Agent',
  });
  const timestampSeconds = Math.floor(Date.now() / 1000);
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      'x-pagespace-timestamp': String(timestampSeconds),
      'x-pagespace-signature': signPayload(secret, timestampSeconds, rawBody),
    },
    body: rawBody,
  });
  if (!response.ok) {
    throw new Error(
      `Documentation agent webhook responded ${response.status}: ${await response.text()}`,
    );
  }
}

function readFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith('--') || i + 1 >= args.length) {
      throw new Error(`Invalid flag near "${args[i]}"`);
    }
    flags[args[i].slice(2)] = args[i + 1];
  }
  return flags;
}

function requireFlag(flags: Record<string, string>, name: string): string {
  const value = flags[name];
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const [channel, ...rest] = process.argv.slice(2);
  if (!CHANNELS.includes(channel as Channel)) {
    throw new Error(`Channel must be one of: ${CHANNELS.join(', ')}`);
  }
  const flags = readFlags(rest);
  const taskIds = flags.tasks
    ? extractTaskIds(flags.tasks)
    : extractTaskIds(`${flags.ref ?? ''}`);

  let content: string;
  if (flags.message) {
    content = flags.message;
  } else if (channel === 'incidents') {
    content = composeIncidentMessage({
      ref: requireFlag(flags, 'ref'),
      sha: requireFlag(flags, 'sha'),
      runUrl: requireFlag(flags, 'run-url'),
      taskIds,
    });
  } else {
    content = composeMergeMessage({
      pr: Number(requireFlag(flags, 'pr')),
      title: requireFlag(flags, 'title'),
      url: requireFlag(flags, 'url'),
      sha: requireFlag(flags, 'sha'),
      base: requireFlag(flags, 'base'),
      taskIds,
    });
  }

  await postToDrive(channel as Channel, content);
  console.log(`Posted to ${channel}`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error((error as Error).message);
    process.exit(1);
  });
}
