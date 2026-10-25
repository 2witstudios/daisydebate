import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleRound } from '../mock/debate-room';
import { initialRoomState, pageToneOf, reduceRoom } from './room-state';

setupRitewayBun();

const now = '2026-10-05T18:30:00.000Z';
const casual = sampleRound('prep', 'casual');
const rated = sampleRound('prep', 'ranked');

describe('initialRoomState', () => {
  test('opens the round folder', () => {
    const state = initialRoomState(casual);
    assert({
      given: 'a round with three round documents',
      should: 'open each as a tab and show the first',
      actual: state.tabs,
      expected: { open: ['doc-flow', 'doc-cx', 'doc-nr'], active: 'doc-flow' },
    });
  });
  test('opens on the transcript while the ballots are written', () => {
    const judging = sampleRound('judging', 'casual');
    assert({
      given:
        'the judging window of a transcribed round, then one with no transcript',
      should:
        'put the transcript first and show it, else open the round folder as usual',
      actual: [
        initialRoomState(judging).tabs,
        initialRoomState({ ...judging, transcribing: false }).tabs,
      ],
      expected: [
        {
          open: ['transcript', 'doc-flow', 'doc-cx', 'doc-nr'],
          active: 'transcript',
        },
        { open: ['doc-flow', 'doc-cx', 'doc-nr'], active: 'doc-flow' },
      ],
    });
  });
});

describe('reduceRoom layout', () => {
  test('resizing pins, choosing Auto unpins', () => {
    const reduce = reduceRoom(casual);
    const resized = reduce(initialRoomState(casual), {
      type: 'layout/resize',
      startPx: 130,
      deltaPx: 70,
    });
    assert({
      given: 'the video dragged 70px taller under Auto during prep',
      should: 'pin Focus at the new height',
      actual: resized.layout,
      expected: { mode: 'focus', videoHeight: 200 },
    });
    assert({
      given: 'the pinned layout and Auto chosen from the menu',
      should: 'follow the phase again',
      actual: reduce(resized, { type: 'layout/mode', mode: 'auto' }).layout,
      expected: { mode: 'auto', videoHeight: null },
    });
  });
});

describe('reduceRoom doc/create', () => {
  test('a new document from the palette', () => {
    const reduce = reduceRoom(casual);
    const state = reduce(
      { ...initialRoomState(casual), paletteOpen: true },
      {
        type: 'doc/create',
        id: 'doc-new',
        now,
        templateId: 'flow',
        folder: 'round',
      },
    );
    assert({
      given: 'a flow created while a Flow exists',
      should: 'add it under a unique title, open it and close the palette',
      actual: {
        title: state.documents.at(-1)?.title,
        active: state.tabs.active,
        paletteOpen: state.paletteOpen,
      },
      expected: { title: 'Flow 2', active: 'doc-new', paletteOpen: false },
    });
  });
});

describe('reduceRoom agent/edit', () => {
  const reduce = reduceRoom(casual);
  const apply = {
    type: 'agent/edit',
    turnId: 'a2',
    outcome: 'applied',
    documentId: 'doc-nr',
    removed: ['0:30 N3 hospital exemption New in 1AR'],
    added: [
      '0:15 N3 hospital exemption, call it out and move on',
      '0:15 extra time on N2 weighing',
    ],
    now,
  } as const;

  test('applying an edit', () => {
    const before = initialRoomState(casual);
    const after = reduce(before, apply);
    const doc = after.documents.find((d) => d.id === 'doc-nr');
    assert({
      given: 'an agent edit applied to the NR plan',
      should:
        'replace the removed line with the added ones in place, record the outcome and open the document',
      actual: {
        removed: doc?.html.includes('N3 hospital exemption <span'),
        inPlace: doc?.html.includes(
          '<li><p>0:15 N3 hospital exemption, call it out and move on</p></li>' +
            '<li><p>0:15 extra time on N2 weighing</p></li>' +
            '<li><p><strong>0:30</strong> voters</p></li></ul>',
        ),
        outcome: after.edits.a2,
        active: after.tabs.active,
        updatedAt: doc?.updatedAt,
      },
      expected: {
        removed: false,
        inPlace: true,
        outcome: 'applied',
        active: 'doc-nr',
        updatedAt: now,
      },
    });
  });

  test('a decided edit is final', () => {
    const once = reduce(initialRoomState(casual), apply);
    assert({
      given: 'the same edit applied twice',
      should: 'leave the state as the first application left it',
      actual: reduce(once, apply),
      expected: once,
    });
  });

  test('discarding an edit', () => {
    const before = initialRoomState(casual);
    const after = reduce(before, { ...apply, outcome: 'discarded' });
    assert({
      given: 'an agent edit discarded',
      should: 'record it and leave the documents untouched',
      actual: { outcome: after.edits.a2, documents: after.documents },
      expected: { outcome: 'discarded', documents: before.documents },
    });
  });
});

describe('reduceRoom drawer', () => {
  test('a rated round has no AI tab', () => {
    const before = initialRoomState(rated);
    const reduce = reduceRoom(rated);
    assert({
      given: 'a request for the AI tab in a rated round, on either screen',
      should: 'leave the drawer as it was',
      actual: [
        reduce(before, { type: 'drawer/tab', tab: 'ai' }),
        reduce(before, { type: 'drawer/phone', tab: 'ai' }),
      ],
      expected: [before, before],
    });
  });

  test('closing and reopening', () => {
    const reduce = reduceRoom(casual);
    const closed = reduce(initialRoomState(casual), {
      type: 'drawer/toggle',
    });
    assert({
      given: 'the open drawer toggled, then a tab chosen',
      should: 'close it, then reopen it on that tab',
      actual: [
        closed.drawerOpen,
        reduce(closed, { type: 'drawer/tab', tab: 'chat' }),
      ],
      expected: [false, { ...closed, drawer: 'chat', drawerOpen: true }],
    });
  });

  test('the phone round tabs', () => {
    const reduce = reduceRoom(casual);
    const room = reduce(initialRoomState(casual), {
      type: 'drawer/phone',
      tab: 'room',
    });
    assert({
      given: 'Room chosen on a phone, then Doc',
      should:
        'show the Room tab in place of the document, then the document again',
      actual: [
        [room.drawer, room.phoneDrawer, room.drawerOpen],
        reduce(room, { type: 'drawer/phone', tab: null }).phoneDrawer,
      ],
      expected: [['room', true, true], false],
    });
  });
});

describe('reduceRoom doc/loaded and doc/add', () => {
  const reduce = reduceRoom(casual);
  const flow = casual.documents.find((d) => d.id === 'doc-flow')!;

  test('the server’s documents arrive', () => {
    const empty = { ...initialRoomState({ ...casual, documents: [] }) };
    const state = reduce(empty, { type: 'doc/loaded', documents: [flow] });
    assert({
      given: 'a room with no documents loading the server’s',
      should: 'hold them and open the round documents',
      actual: { ids: state.documents.map((d) => d.id), tabs: state.tabs },
      expected: {
        ids: ['doc-flow'],
        tabs: { open: ['doc-flow'], active: 'doc-flow' },
      },
    });
  });

  test('a document the server created', () => {
    const state = reduce(
      { ...initialRoomState(casual), paletteOpen: true },
      {
        type: 'doc/add',
        document: { ...flow, id: 'doc-new', title: 'Flow 2' },
      },
    );
    assert({
      given: 'a document created on the server',
      should: 'add it, open it and close the palette',
      actual: { active: state.tabs.active, paletteOpen: state.paletteOpen },
      expected: { active: 'doc-new', paletteOpen: false },
    });
  });
});

describe('reduceRoom page/tone', () => {
  test('one document’s page', () => {
    const state = reduceRoom(casual)(initialRoomState(casual), {
      type: 'page/tone',
      documentId: 'doc-flow',
      tone: 'light',
    });
    assert({
      given: 'Light chosen for Flow',
      should: 'make Flow light and leave CX dark',
      actual: [pageToneOf(state, 'doc-flow'), pageToneOf(state, 'doc-cx')],
      expected: ['light', 'dark'],
    });
  });
});
