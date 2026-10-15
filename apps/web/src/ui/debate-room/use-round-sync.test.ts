import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { DocumentsApi } from './document-sync';
import { manualTimers, stored } from './document-sync.test-support';
import { RETRYING_NOTICE, refusedNotice } from './save-notice';
import {
  initialSaveStatus,
  reduceSave,
  roundSync,
  type SaveEvent,
} from './use-round-sync';

setupRitewayBun();

describe('reduceSave', () => {
  test('the save state and notice', () => {
    const after = (...events: SaveEvent[]) =>
      events.reduce(reduceSave, initialSaveStatus);
    assert({
      given:
        'an edit, a failed save that retries, a refusal, a conflict, and a save after a retry',
      should:
        'show Saving, then Not saved with the matching notice, and Saved with no notice once stored',
      actual: [
        after({ type: 'edit' }),
        after({ type: 'edit' }, { type: 'retrying' }),
        after({ type: 'refused', status: 413 }),
        after({ type: 'conflict' }).save,
        after({ type: 'retrying' }, { type: 'saved' }),
      ],
      expected: [
        { save: 'saving', notice: null },
        { save: 'unsaved', notice: RETRYING_NOTICE },
        { save: 'unsaved', notice: refusedNotice(413) },
        'unsaved',
        initialSaveStatus,
      ],
    });
  });
});

describe('roundSync', () => {
  const api = (save: DocumentsApi['save']): DocumentsApi => ({
    list: async () => [stored('a')],
    create: async () => stored('b'),
    save,
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  test('a save that lands', async () => {
    const events: SaveEvent[] = [];
    const { timers, fire } = manualTimers();
    const sync = roundSync(
      'r',
      api(async () => ({ status: 'saved', revision: 2 })),
      (event) => events.push(event),
      timers,
    );
    await sync.load();
    sync.change('a', '<p>edited</p>');
    fire();
    await settle();
    assert({
      given: 'an edit that the server stores',
      should: 'report the edit, then the save',
      actual: events.map((e) => e.type),
      expected: ['edit', 'saved'],
    });
  });

  test('a save that fails', async () => {
    const events: SaveEvent[] = [];
    const { timers, fire } = manualTimers();
    const sync = roundSync(
      'r',
      api(async () => {
        throw new Error('offline');
      }),
      (event) => events.push(event),
      timers,
    );
    await sync.load();
    sync.change('a', '<p>edited</p>');
    fire();
    await settle();
    assert({
      given: 'an edit whose save cannot reach the server',
      should: 'report the edit, then a retry',
      actual: events.map((e) => e.type),
      expected: ['edit', 'retrying'],
    });
  });
});
