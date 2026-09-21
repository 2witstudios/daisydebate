import { describe, test } from 'riteway/bun';
import { setupRitewayBun, assert } from 'riteway/bun';
import { conversationIdFor, dispatchDocumentationEvent } from './docs-consult';
import {
  baseOptions,
  mergeEvent,
  ok,
  routedFetch,
} from './docs-consult.test-support';
import { DOCUMENTATION_PROMPT_VERSION } from './docs-prompts';
import { RUN_RECORD_COLUMNS, runRecordsFromSheet } from './docs-runs-sheet';

setupRitewayBun();

const header = {
  rowIndex: 0,
  cells: Object.fromEntries(
    RUN_RECORD_COLUMNS.map(({ column, field }) => [
      column,
      { raw: field, value: field },
    ]),
  ),
};

describe('dispatchDocumentationEvent receipt', async () => {
  test('reserves a failed receipt row before consulting and names it', async () => {
    const event = mergeEvent('fix: only technical');
    let appendsAtConsult = -1;
    const stub = routedFetch({
      consult: async () => {
        appendsAtConsult = stub.counts.appends;
        return ok();
      },
      firstRowIndex: 6,
    });
    await dispatchDocumentationEvent(event, {
      ...baseOptions,
      fetchImpl: stub.fetchImpl,
    });
    const [row] = stub.appended;
    const question = String(stub.consults[0]?.body.question);
    assert({
      given: 'a fresh merge event',
      should:
        'append one failed receipt with the trusted keys first, then point the agent at that row',
      actual: {
        appendsAtConsult,
        runId: row?.A,
        workflow: row?.B,
        status: row?.E,
        snapshot: row?.F,
        promptVersion: row?.G,
        idempotencyKey: row?.H,
        namesRow: question.includes('row 7 of the Documentation Runs sheet'),
      },
      expected: {
        appendsAtConsult: 1,
        runId: conversationIdFor(event.idempotencyKey, 'technical-docs'),
        workflow: 'technical-docs',
        status: 'failed',
        snapshot: `${event.repository}@${event.commit}`,
        promptVersion: DOCUMENTATION_PROMPT_VERSION,
        idempotencyKey: event.idempotencyKey,
        namesRow: true,
      },
    });
  });

  test('reserves a row the reconciler reads as not yet covered', async () => {
    const stub = routedFetch({ consult: async () => ok(), firstRowIndex: 1 });
    await dispatchDocumentationEvent(mergeEvent('fix: only technical'), {
      ...baseOptions,
      fetchImpl: stub.fetchImpl,
    });
    const [record] = runRecordsFromSheet([
      header,
      {
        rowIndex: 1,
        cells: Object.fromEntries(
          Object.entries(stub.appended[0] ?? {}).map(([column, raw]) => [
            column,
            { raw, value: raw },
          ]),
        ),
      },
    ]);
    assert({
      given: 'the reserved row before the agent rewrites it',
      should: 'parse as a valid run record whose failed status is no receipt',
      actual: record?.status,
      expected: 'failed',
    });
  });

  test('reports an existing conversation without reserving or consulting', async () => {
    const stub = routedFetch({
      consult: async () => ok(),
      existing: ['user', 'assistant'],
    });
    const outcomes = await dispatchDocumentationEvent(
      mergeEvent('fix: only technical'),
      { ...baseOptions, fetchImpl: stub.fetchImpl },
    );
    assert({
      given: 'a re-run of a merge whose conversation already exists',
      should:
        'report already-dispatched and add no row, so replays leave no noise',
      actual: {
        outcomes: outcomes.map((outcome) => outcome.outcome),
        appends: stub.counts.appends,
        consults: stub.counts.consult,
      },
      expected: {
        outcomes: ['already-dispatched'],
        appends: 0,
        consults: 0,
      },
    });
  });
});
