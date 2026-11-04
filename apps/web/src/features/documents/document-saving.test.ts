import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { newDraftCopy } from './document-draft';
import {
  acknowledged,
  attemptFailed,
  conflictOutcome,
  edited,
  holdsUnstoredText,
  idleSignal,
  initialSaving,
  nextSend,
  offersOf,
  savingDocument,
  serverRead,
  withDocument,
} from './document-saving';

setupRitewayBun();

const copy = (generation: string, html = `<p>${generation}</p>`) =>
  newDraftCopy({ generation, html, baseRevision: 1, now: 100 });
const blank = savingDocument(initialSaving, 'a');
const read = { ...blank, revision: 1, serverHtml: '<p>server</p>' };

describe('nextSend', () => {
  test('sends only what is ready', () => {
    const one = copy('one');
    assert({
      given: 'nothing pending, no revision, a refused edit, and a conflict',
      should: 'send nothing, and otherwise send the pending edit',
      actual: [
        nextSend(read),
        nextSend({ ...blank, pending: one }),
        nextSend({
          ...read,
          pending: one,
          hold: { kind: 'refused', generation: 'one' },
        }),
        nextSend({
          ...read,
          pending: one,
          hold: { kind: 'conflict', latestRevision: 2 },
        }),
        nextSend({ ...read, pending: one }),
      ],
      expected: [null, null, null, null, { sent: one, expectedRevision: 1 }],
    });
  });
});

describe('serverRead', () => {
  test('only the first read sets the revision', () => {
    const one = copy('one');
    assert({
      given:
        'a newer read with a pending edit, and with none, and a first read',
      should: 'move nothing once a revision is known',
      actual: [
        serverRead({ ...read, pending: one }, { html: 'x', revision: 9 })
          .revision,
        serverRead(read, { html: 'x', revision: 9 }).revision,
      ],
      expected: [1, 1],
    });
  });
});

describe('acknowledged', () => {
  test('a newer edit rebases and this owner keeps its earlier copies', () => {
    const sent = copy('sent');
    const newer = copy('newer');
    const { document, draft } = acknowledged(
      edited(edited(read, sent), newer),
      sent,
      2,
      { active: newer },
    );
    assert({
      given: 'an acknowledgement while a newer edit is pending',
      should: 'keep the newer edit, based on the new revision',
      actual: [
        document.pending?.baseRevision,
        draft.record.active?.baseRevision,
      ],
      expected: [2, 2],
    });
  });

  test('with nothing newer, this owner has nothing left to recover', () => {
    const sent = copy('sent');
    const { document, draft } = acknowledged(edited(read, sent), sent, 2, {
      active: sent,
    });
    assert({
      given: 'the last pending edit acknowledged',
      should: 'clear the pending edit and the stored copy',
      actual: [document.pending, document.serverHtml, draft.record],
      expected: [undefined, sent.html, {}],
    });
  });
});

describe('conflictOutcome', () => {
  const sent = copy('sent', '<p>mine</p>');
  test('the server holding this text is no conflict', () => {
    assert({
      given: 'a refused save whose text the server already holds',
      should: 'treat it as committed at the server revision',
      actual: conflictOutcome(read, sent, 5, {
        id: 'a',
        html: '<p>mine</p>',
        revision: 5,
      }),
      expected: { kind: 'committed', copy: sent, revision: 5 },
    });
  });

  test('other text is a conflict, and a missing document is gone', () => {
    assert({
      given: 'other text on the server, then no server copy at all',
      should: 'report the newest revision, then that it is gone',
      actual: [
        conflictOutcome(read, sent, 5, {
          id: 'a',
          html: '<p>theirs</p>',
          revision: 6,
        }),
        conflictOutcome(read, sent, 5, undefined),
      ],
      expected: [{ kind: 'conflicted', latestRevision: 6 }, { kind: 'gone' }],
    });
  });
});

describe('attemptFailed', () => {
  const sent = copy('sent');
  test('a capacity refusal is retried and keeps the edit', () => {
    const result = attemptFailed({ ...read, pending: sent }, sent, 503, 1000);
    assert({
      given: 'a save refused for capacity',
      should: 'keep the edit pending and retry with backoff',
      actual: [
        result.kind,
        result.document.pending,
        result.kind === 'retry' && result.afterMs,
      ],
      expected: ['retry', sent, 2000],
    });
  });

  test('a refusal stops only that generation', () => {
    const result = attemptFailed({ ...read, pending: sent }, sent, 403, 1000);
    assert({
      given: 'a save the server refuses for good',
      should: 'stop that generation and keep its text',
      actual: [result.kind, result.document.hold, result.document.pending],
      expected: ['refused', { kind: 'refused', generation: 'sent' }, sent],
    });
  });

  test('a deleted document stops saving and keeps the text', () => {
    const result = attemptFailed({ ...read, pending: sent }, sent, 404, 1000);
    assert({
      given: 'a save answered 404',
      should: 'mark it gone, keep the edit, and send nothing more',
      actual: [result.kind, result.document.pending, nextSend(result.document)],
      expected: ['gone', sent, null],
    });
  });

  test('backoff is bounded', () => {
    const result = attemptFailed({ ...read, failures: 20 }, sent, null, 1000);
    assert({
      given: 'many failures in a row',
      should: 'wait no longer than thirty seconds',
      actual: result.kind === 'retry' && result.afterMs,
      expected: 30_000,
    });
  });
});

describe('the whole state', () => {
  const one = copy('one');
  const typing = withDocument(initialSaving, 'a', () => ({
    ...read,
    pending: one,
  }));
  test('holdsUnstoredText', () => {
    assert({
      given: 'a pending edit with no stored copy, then with one',
      should: 'hold unstored text only in the first case',
      actual: [
        holdsUnstoredText(typing),
        holdsUnstoredText(
          withDocument(typing, 'a', (d) => ({
            ...d,
            durableGeneration: 'one',
          })),
        ),
      ],
      expected: [true, false],
    });
  });

  test('idleSignal', () => {
    assert({
      given: 'a pending edit, a conflict, and nothing moving',
      should: 'say busy, conflict and saved',
      actual: [
        idleSignal(typing).kind,
        idleSignal(
          withDocument(typing, 'a', (d) => ({
            ...d,
            hold: { kind: 'conflict', latestRevision: 2 },
          })),
        ).kind,
        idleSignal(initialSaving).kind,
      ],
      expected: ['busy', 'conflict', 'saved'],
    });
  });

  test('offersOf never offers a copy based on an unseen revision', () => {
    const future = { ...one, baseRevision: 9 };
    const documents = new Map([
      [
        'a',
        {
          ...read,
          snapshot: { record: { recovery: future }, raw: null },
        },
      ],
    ]);
    assert({
      given: 'a stored copy ahead of what this owner has read',
      should: 'not offer it',
      actual: offersOf(documents),
      expected: [],
    });
  });
});
