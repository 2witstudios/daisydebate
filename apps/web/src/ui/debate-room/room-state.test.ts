import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleRound } from '../mock/debate-room';
import { initialRoomState, pageToneOf, reduceRoom } from './room-state';

setupRitewayBun();

const now = '2026-10-05T18:30:00.000Z';
const casual = sampleRound('prep', 'casual');

test('an accepted recovery uses the ordinary document and tab transitions', () => {
  const reduce = reduceRoom();
  const before = initialRoomState(casual);
  const updated = reduce(before, {
    type: 'doc/update',
    id: 'doc-flow',
    html: '<p>recovered</p>',
    now,
  });
  const opened = reduce(updated, { type: 'tabs/open', id: 'doc-flow' });
  assert({
    given: 'HTML accepted by the sync owner',
    should: 'update and open its document through ordinary editing actions',
    actual: [
      opened.documents.find((d) => d.id === 'doc-flow')?.html,
      opened.tabs.active,
    ],
    expected: ['<p>recovered</p>', 'doc-flow'],
  });
});

describe('initialRoomState', () => {
  test('opens on the transcript beside no document', () => {
    const state = initialRoomState(casual);
    assert({
      given: 'a new Round room',
      should:
        'open no document until the drive loads, show Transcript and Files, and start a phone on the document',
      actual: [state.tabs, state.sidebar, state.filesOpen, state.phone],
      expected: [{ open: [], active: null }, 'transcript', true, 'doc'],
    });
  });
});

describe('reduceRoom doc/create', () => {
  test('a new document from the palette', () => {
    const reduce = reduceRoom();
    const state = reduce(
      { ...initialRoomState(casual), paletteOpen: true },
      {
        type: 'doc/create',
        id: 'doc-new',
        now,
      },
    );
    assert({
      given: 'a new document',
      should: 'add it, open it and close the palette',
      actual: {
        title: state.documents.at(-1)?.title,
        active: state.tabs.active,
        paletteOpen: state.paletteOpen,
      },
      expected: { title: 'Untitled', active: 'doc-new', paletteOpen: false },
    });
  });
});

describe('reduceRoom agent/edit', () => {
  const reduce = reduceRoom();
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

describe('reduceRoom sidebars', () => {
  const reduce = reduceRoom();
  const before = initialRoomState(casual);

  test('Files closes and reopens by hand', () => {
    const closed = reduce(before, { type: 'files/toggle' });
    assert({
      given: 'Files toggled twice',
      should: 'close it, then open it again',
      actual: [closed.filesOpen, reduce(closed, { type: 'files/toggle' })],
      expected: [false, before],
    });
  });

  test('the Round sidebar switches tabs and never closes', () => {
    const chat = reduce(before, { type: 'sidebar/tab', tab: 'channels' });
    assert({
      given: 'Channels chosen, then AI chat',
      should: 'show each in turn',
      actual: [
        chat.sidebar,
        reduce(chat, { type: 'sidebar/tab', tab: 'ai' }).sidebar,
      ],
      expected: ['channels', 'ai'],
    });
  });

  test('a channel opens in place and marks itself read', () => {
    const open = reduce(before, {
      type: 'channel/open',
      channelId: 'prep',
      now,
    });
    assert({
      given: 'a channel opened from the list, then Back',
      should: 'show its thread and mark it read, then show the list',
      actual: [
        [open.channelId, open.channelOpen, open.readMarkers.prep],
        reduce(open, { type: 'channel/list' }).channelOpen,
      ],
      expected: [['prep', true, now], false],
    });
  });

  test('the phone round tabs', () => {
    const channels = reduce(before, { type: 'phone/panel', panel: 'channels' });
    const room = reduce(channels, { type: 'phone/panel', panel: 'room' });
    assert({
      given: 'Channels chosen on a phone, then Room, then Doc',
      should: 'show one panel at a time and leave the sidebar on its last tab',
      actual: [
        [channels.phone, channels.sidebar],
        [room.phone, room.sidebar],
        reduce(room, { type: 'phone/panel', panel: 'doc' }).phone,
      ],
      expected: [['channels', 'channels'], ['room', 'channels'], 'doc'],
    });
  });
});

describe('reduceRoom doc/loaded and doc/add', () => {
  const reduce = reduceRoom();
  const flow = casual.documents.find((d) => d.id === 'doc-flow')!;

  test('the server’s documents arrive', () => {
    const empty = { ...initialRoomState({ ...casual, documents: [] }) };
    const state = reduce(empty, { type: 'doc/loaded', documents: [flow] });
    assert({
      given: 'a room with no documents loading the server’s',
      should: 'hold them and open the one edited last',
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
    const state = reduceRoom()(initialRoomState(casual), {
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

test('adopted server text is marked until the next ordinary change', async () => {
  const { adoptServerText, updateDocumentHtml } =
    await import('../../features/debate-room/documents/documents');
  const start: Parameters<typeof adoptServerText>[0] = {
    id: 'd',
    title: 'Flow',
    folder: 'library',
    html: '<p>old</p>',
    createdAt: 'then',
    updatedAt: 'then',
  };
  const adopted = adoptServerText(start, '<p>server</p>', 'now');
  const typed = updateDocumentHtml(adopted, '<p>typed</p>', 'later');
  assert({
    given: 'server text adopted, then an ordinary change',
    should: 'mark the adoption, and clear the mark on the change',
    actual: [adopted.html, adopted.textFromServer, typed.textFromServer],
    expected: ['<p>server</p>', true, undefined],
  });
});
