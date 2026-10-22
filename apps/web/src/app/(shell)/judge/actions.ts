'use server';
import { headers } from 'next/headers';
import { readJudgeAssignments } from '../../../features/round-ballots/reads';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { processRoute } from '../../../server/process-app';
const read = processRoute(
  (routes) => (request) => routes.rounds.judgeAssignments(request),
);
export async function readPersistedJudgeAssignments() {
  return readJudgeAssignments(
    inProcessFetch(read, new Headers(await headers())),
  );
}
