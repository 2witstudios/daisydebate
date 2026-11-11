import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  commandAnswer,
  commandRefusalText,
  commandUnavailable,
  roomEditFields,
  roomFormAnswer,
  roomFormFields,
  roomNoticeText,
} from './command-answer';
import { destinationOf, idle, moved } from '../forms/form-state';
import { assemblySnapshot } from './assembly.test-support';
import { answerUnavailableOnThrow } from '../../ui/form-action/form-action';

setupRitewayBun();
test('accepted Launch returns only the persisted Round destination', () => {
  const form = new FormData();
  form.set('type', 'start-round');
  const view = {
    ...assemblySnapshot,
    roundRef: { id: 'r'.repeat(24), status: 'opening' as const },
  };
  assert({
    given: 'a canonical accepted Launch with a persisted Round reference',
    should: 'return navigation action state through the supplied moveOn edge',
    actual: commandAnswer({ kind: 'accepted', view }, view.id, form, {
      hydrated: true,
      move: moved,
    }),
    expected: { kind: 'moved', next: `/rounds/${view.roundRef.id}` },
  });
});
test('a room command whose answer was lost is never called refused or accepted', async () => {
  const form = new FormData();
  form.set('type', 'assign-seat');
  form.set('commandId', 'c'.repeat(24));
  form.set('expectedVersion', '3');
  form.set('actorId', 'actor');
  const original = {
    type: 'assign-seat',
    commandId: 'c'.repeat(24),
    expectedVersion: '3',
    actorId: 'actor',
  };
  const thrown = await answerUnavailableOnThrow(async () => {
    throw new Error('private transport detail');
  }, commandUnavailable)(idle(), form);
  const lost = (hydrated: boolean) =>
    commandAnswer({ kind: 'unavailable' }, assemblySnapshot.id, form, {
      hydrated,
      move: moved,
    });
  assert({
    given:
      'a command the room answered with a server fault or an unreadable reply, and one whose call was dropped, on a hydrated page',
    should:
      'answer each as unacknowledged, keeping exactly the original fields for the retry',
    actual: [lost(true), thrown],
    expected: [
      { kind: 'unacknowledged', values: original },
      { kind: 'unacknowledged', values: original },
    ],
  });
  assert({
    given: 'the same lost answer',
    should:
      'say the command may have been recorded and that the retry cannot run it twice, with nothing from the transport',
    actual: roomFormFields(thrown),
    expected: {
      values: original,
      error:
        'This command may have been recorded. Retry it to find out: a recorded command is confirmed, not run twice.',
    },
  });
  assert({
    given:
      'the same lost answer to a native post, which cannot keep its fields',
    should:
      'return to the room with the unacknowledged notice, whose words send the member to the room itself',
    actual: [
      destinationOf(lost(false)),
      roomNoticeText({ kind: 'unacknowledged' }),
    ],
    expected: [
      `/rooms/${assemblySnapshot.id}?notice=command-unacknowledged#`,
      'That command may have been recorded. Review the room before trying again.',
    ],
  });
});

test('a room edit whose answer was lost keeps what was typed for a new save', () => {
  const form = new FormData();
  form.set('commandId', 'c'.repeat(24));
  form.set('expectedVersion', '3');
  form.set('title', 'Typed title');
  const answer = roomFormAnswer({ kind: 'unavailable' }, form, {
    hydrated: true,
    move: moved,
  });
  assert({
    given: 'a details save the room never answered',
    should:
      'keep the typed fields without the lost save’s command identifier or version, and say the save may have landed and what saving again does',
    actual: [answer.kind, roomEditFields(answer)],
    expected: [
      'unacknowledged',
      {
        values: { title: 'Typed title' },
        error:
          'These changes may have been saved. Check the latest room: saving again applies what is typed here to it.',
      },
    ],
  });
});

test('a hydrated room command answers with the canonical view instead of navigating', () => {
  const form = new FormData();
  form.set('type', 'claim-seat');
  const view = { ...assemblySnapshot, changeVersion: 4, version: 4 };
  const moves: string[] = [];
  const move = (next: string) => {
    moves.push(next);
    return moved(next);
  };
  assert({
    given:
      'an accepted seat claim posted by the hydrated page, and the same without JavaScript',
    should:
      'hand the hydrated page the view with no navigation, and move the native post to the room',
    actual: {
      hydrated: commandAnswer({ kind: 'accepted', view }, view.id, form, {
        hydrated: true,
        move,
      }),
      native: destinationOf(
        commandAnswer({ kind: 'accepted', view }, view.id, form, {
          hydrated: false,
          move,
        }),
      ),
      moves,
    },
    expected: {
      hydrated: { kind: 'accepted', view },
      native: `/rooms/${view.id}#`,
      moves: [`/rooms/${view.id}#`],
    },
  });
});

test('a hydrated refusal stays on the room with its reason', () => {
  const form = new FormData();
  form.set('type', 'claim-seat');
  form.set('role', 'negative');
  const answer = (result: Parameters<typeof commandAnswer>[0]) =>
    commandAnswer(result, assemblySnapshot.id, form, {
      hydrated: true,
      move: moved,
    });
  assert({
    given:
      'a version conflict, another refusal and an unreachable room, posted by the hydrated page',
    should:
      'answer each in place, keeping the posted values and never navigating',
    actual: [
      answer({ kind: 'refused', reason: 'version-conflict' }),
      roomFormFields(answer({ kind: 'refused', reason: 'seat-unavailable' }))
        .error,
      destinationOf(answer({ kind: 'unavailable' })),
    ],
    expected: [
      {
        kind: 'refused',
        values: { type: 'claim-seat', role: 'negative' },
        error: 'The room changed. Review the latest room and try again.',
      },
      'That seat just went: someone has it, or it is held for another member.',
      undefined,
    ],
  });
});

test('native Room details and settings answers clear an inherited setup fragment', () => {
  const result = { kind: 'accepted' as const, view: assemblySnapshot };
  const move = moved;
  assert({
    given: 'an accepted Room edit through the native or hydrated server action',
    should:
      'redirect the native post to an explicit empty fragment and adopt the hydrated view',
    actual: [
      roomFormAnswer(result, new FormData(), { hydrated: false, move }),
      roomFormAnswer(result, new FormData(), { hydrated: true, move }),
    ],
    expected: [
      { kind: 'moved', next: `/rooms/${assemblySnapshot.id}#` },
      { kind: 'accepted', view: assemblySnapshot },
    ],
  });
});

test('a refused format choice says why, with and without JavaScript (PR #472 review)', () => {
  const form = new FormData();
  form.set('type', 'select-format');
  const answer = (hydrated: boolean) =>
    commandAnswer(
      { kind: 'refused', reason: 'format-unavailable' },
      assemblySnapshot.id,
      form,
      { hydrated, move: moved },
    );
  assert({
    given:
      'a stale format choice posted by a hydrated page and by a native form, and each and format refusal',
    should:
      'show its reason in place, carry it back to the page in the closed vocabulary, and word each in the room’s terms',
    actual: {
      hydrated: roomFormFields(answer(true)).error,
      native: destinationOf(answer(false)),
      words: [
        'format-unavailable',
        'illegal-config',
        'not-ready',
        'readiness-unavailable',
        'actor-ineligible',
        'draw-unavailable',
        null,
      ].map((reason) => commandRefusalText(reason as never)),
    },
    expected: {
      hydrated: 'That format is no longer offered. Choose from the list now.',
      native: `/rooms/${assemblySnapshot.id}?notice=command-refused&reason=format-unavailable#`,
      words: [
        'That format is no longer offered. Choose from the list now.',
        'Those settings don’t fit this format: a set resolution needs one written in; a strike takes none.',
        'Everyone seated must be Ready first.',
        'Ready can’t be read right now. Try again in a moment.',
        'Someone in a seat can’t take part right now.',
        'There aren’t enough resolutions to draw from. Choose another source or add lines.',
        'The room refused that command. Review the current room and try again.',
      ],
    },
  });
});

test('a Launch refused for bot capacity says the bots are busy (ISSUE-773)', () => {
  const form = new FormData();
  form.set('type', 'start-round');
  assert({
    given:
      'a hydrated Launch refused because live bot-debater capacity is full',
    should:
      'say the bots are busy and to try again shortly, not a generic error',
    actual: roomFormFields(
      commandAnswer(
        { kind: 'refused', reason: 'bots-busy' },
        assemblySnapshot.id,
        form,
        { hydrated: true, move: moved },
      ),
    ).error,
    expected: 'Bots are busy right now. Try again shortly.',
  });
});
