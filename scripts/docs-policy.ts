#!/usr/bin/env bun
import {
  FINDING_SEVERITIES,
  parseDocumentationEvent,
  publicationDecision,
  RUN_RECORD_STATUSES,
  type FindingSeverity,
  type PublicationApprovals,
  type RunRecordStatus,
} from './docs-contracts';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseApprovals(value: unknown): PublicationApprovals {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error('approvals must be an object');
  const approvals: { human?: { by: string; at: string }; blog?: { by: string; at: string } } =
    {};
  for (const kind of ['human', 'blog'] as const) {
    const entry = value[kind];
    if (entry === undefined || entry === null) continue;
    if (!isRecord(entry) || typeof entry.by !== 'string' || typeof entry.at !== 'string')
      throw new Error(`approvals.${kind} must be { by, at }`);
    approvals[kind] = { by: entry.by, at: entry.at };
  }
  return approvals;
}

async function main(): Promise<void> {
  const raw = JSON.parse(await new Response(Bun.stdin.stream()).text());
  if (!isRecord(raw)) throw new Error('candidate must be a JSON object');
  const event = parseDocumentationEvent(raw.event);
  const textRisk = event.textRisk ?? 'flagged';
  const runStatus =
    raw.runStatus === undefined ? 'complete' : (raw.runStatus as RunRecordStatus);
  if (!RUN_RECORD_STATUSES.includes(runStatus))
    throw new Error(`runStatus must be one of ${RUN_RECORD_STATUSES.join(', ')}`);
  const findings = (raw.findings ?? []) as FindingSeverity[];
  if (
    !Array.isArray(findings) ||
    !findings.every((severity) => FINDING_SEVERITIES.includes(severity))
  )
    throw new Error(`findings must be a subset of ${FINDING_SEVERITIES.join(', ')}`);
  const decision = publicationDecision({
    changeKind: event.classification.changeKind,
    pipelines: event.classification.pipelines,
    findings,
    runStatus,
    textRisk,
    approvals: parseApprovals(raw.approvals),
  });
  process.stdout.write(
    `${JSON.stringify({ idempotencyKey: event.idempotencyKey, ...decision }, null, 2)}\n`,
  );
}

if (import.meta.main) {
  await main();
}
