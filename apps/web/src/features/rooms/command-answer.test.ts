import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  commandAnswer,
  commandRefusalText,
  commandUnavailable,
  roomFormAnswer,
} from './command-answer';
import { assemblySnapshot } from './assembly.test-support';
import { answerUnavailableOnThrow } from '../../ui/form-action/form-action';

setupRitewayBun();
test('accepted Launch returns only the persisted Round destination', () => {
  const form = new FormData();
  form.set('type', 'start-round');
  const view = {
    ...assemblySnapshot,
    roundRef: { id: 'r'.repeat(24), status: 'scheduled' as const },
  };
  assert({
    given: 'a canonical accepted Launch with a persisted Round reference',
    should: 'return navigation action state through the supplied moveOn edge',
    actual: commandAnswer({ kind: 'accepted', view }, view.id, form, {
      hydrated: true,
      move: (next) => ({ next }),
    }).next,
    expected: `/rounds/${view.roundRef.id}`,
  });
});
test('refusal and broken transport never answer as acknowledged commands', async () => {
  const form = new FormData();
  form.set('type', 'assign-seat');
  form.set('actorId', 'actor');
  const unavailable = answerUnavailableOnThrow(async () => {
    throw new Error('private transport detail');
  }, commandUnavailable);
  const state = await unavailable({ values: {} }, form);
  assert({
    given: 'a refused canonical command and a rejected hydrated action',
    should:
      'reread refusals and retain retry inputs without leaking internals or claiming success',
    actual: [
      commandAnswer({ kind: 'unavailable' }, assemblySnapshot.id, form, {
        hydrated: false,
        move: (next) => ({ next }),
      }).next,
      state.values.actorId,
      Boolean(state.error),
      state.next,
      state.error?.includes('private'),
    ],
    expected: [
      `/rooms/${assemblySnapshot.id}?notice=command-refused#`,
      'actor',
      true,
      undefined,
      false,
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
    return { next };
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
      native: commandAnswer({ kind: 'accepted', view }, view.id, form, {
        hydrated: false,
        move,
      }).next,
      moves,
    },
    expected: {
      hydrated: { values: {}, view },
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
      move: (next) => ({ next }),
    });
  assert({
    given:
      'a version conflict, another refusal and an unreachable room, posted by the hydrated page',
    should:
      'answer each in place, keeping the posted values and never navigating',
    actual: [
      answer({ kind: 'refused', reason: 'version-conflict' }),
      answer({ kind: 'refused', reason: 'seat-unavailable' }).error,
      answer({ kind: 'unavailable' }).next,
    ],
    expected: [
      {
        values: { type: 'claim-seat', role: 'negative' },
        error: 'The room changed. Review the latest room and try again.',
      },
      'The command was not acknowledged. Review the current room and try again.',
      undefined,
    ],
  });
});

test('native Room details and settings answers clear an inherited setup fragment', () => {
  const result = { kind: 'accepted' as const, view: assemblySnapshot };
  const move = (next: string) => ({ next });
  assert({
    given: 'an accepted Room edit through the native or hydrated server action',
    should:
      'redirect the native post to an explicit empty fragment and adopt the hydrated view',
    actual: [
      roomFormAnswer(result, new FormData(), { hydrated: false, move }),
      roomFormAnswer(result, new FormData(), { hydrated: true, move }),
    ],
    expected: [
      { values: {}, next: `/rooms/${assemblySnapshot.id}#` },
      { values: {}, view: assemblySnapshot },
    ],
  });
});

test('a refused strike or format choice says why, with and without JavaScript (PR #472 review)', () => {
  const form = new FormData();
  form.set('type', 'strike-resolution');
  const answer = (hydrated: boolean) =>
    commandAnswer(
      { kind: 'refused', reason: 'strike-conflict' },
      assemblySnapshot.id,
      form,
      { hydrated, move: (next) => ({ next }) },
    );
  assert({
    given:
      'a stale strike posted by a hydrated page and by a native form, and each strike and format refusal',
    should:
      'show its reason in place, carry it back to the page in the closed vocabulary, and word each in the room’s terms',
    actual: {
      hydrated: answer(true).error,
      native: answer(false).next,
      words: [
        'strike-conflict',
        'not-your-turn',
        'strike-unavailable',
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
      hydrated: 'Someone struck first, or time ran out. Here is the draw now.',
      native: `/rooms/${assemblySnapshot.id}?notice=command-refused&reason=strike-conflict#`,
      words: [
        'Someone struck first, or time ran out. Here is the draw now.',
        'You can’t strike on this turn.',
        'That resolution can’t be struck now.',
        'That format is no longer offered. Choose from the list now.',
        'Those settings don’t fit this format: a set resolution needs one written in; a strike takes none.',
        'Everyone seated must be Ready first.',
        'Ready can’t be read right now. Try again in a moment.',
        'Someone in a seat can’t take part right now.',
        'There aren’t enough resolutions to draw from. Choose another source or add lines.',
        'The command was not acknowledged. Review the current room and try again.',
      ],
    },
  });
});
