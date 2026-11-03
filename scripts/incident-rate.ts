#!/usr/bin/env bun
/**
 * Prints the platform incident rate and capture coverage for a period, for
 * Project Status and each drill's report. Usage: bun incident:rate [days].
 */
import { SQL } from 'bun';
import { readRoundIncidentRate } from '@daisy/db/round-incident-rate';

const days = Number(process.argv[2] ?? 30);
if (!Number.isFinite(days) || days <= 0)
  throw new Error('Usage: bun incident:rate [days]');
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const until = new Date();
const from = new Date(until.getTime() - days * 86_400_000);
const sql = new SQL(url);
try {
  console.log(
    JSON.stringify(
      { from, until, ...(await readRoundIncidentRate(sql, { from, until })) },
      null,
      2,
    ),
  );
} finally {
  await sql.end();
}
