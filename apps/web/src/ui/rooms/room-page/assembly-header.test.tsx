import type { RoomView } from '@daisy/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { byText, findElements } from '../../test-support/find-elements';
import { AssemblyHeader, RoomResolution } from './assembly-header';
import { RoomInvite } from './room-invite';

setupRitewayBun();
const action = async () => ({ values: {} });
const header = (view: RoomView, actorId: string, roomNumber?: number) =>
  AssemblyHeader({
    view,
    actorId,
    ...(roomNumber === undefined ? {} : { roomNumber }),
    commandIds: { leave: 'leave-id', close: 'close-id' },
    commandAction: action,
  });
const seated = {
  ...assemblySnapshot,
  participants: [
    {
      id: 'p'.repeat(24),
      actorId: 'v'.repeat(24),
      label: 'Viewer',
      consentVersion: 0,
      kind: 'human' as const,
      role: 'negative' as const,
      slot: 0,
      needsReady: true,
      ready: 'not-ready' as const,
      eligible: true,
    },
  ],
  capabilities: { ...assemblySnapshot.capabilities, canEdit: false },
};

test('the room name is the page title, with status and meta lines and no badges', () => {
  const tree = header(seated, 'v'.repeat(24));
  const html = renderToStaticMarkup(tree);
  assert({
    given: 'a seated guest in an assembling casual team room',
    should:
      'title the page with the room name, say status and meta in words, offer invite and Leave seat, and no Room setup',
    actual: [
      byText(tree, 'h1', seated.title)?.type,
      html.includes('Setting up · 1 of 6 seats filled'),
      html.includes('Casual · ratings don’t change'),
      html.includes(seated.topic),
      findElements(tree, (element) => element.type === RoomInvite)[0]?.props
        .label,
      Boolean(byText(tree, 'button', 'Leave seat')),
      html.includes('Room setup'),
    ],
    expected: ['h1', true, true, false, 'Copy invite link', true, false],
  });
});

test('the host reaches Room setup from the header and has no seat to leave', () => {
  const html = renderToStaticMarkup(
    header(assemblySnapshot, assemblySnapshot.hostActorId),
  );
  assert({
    given: 'the host before taking a seat',
    should: 'link Room setup without Leave seat',
    actual: [html.includes('href="#room-setup"'), html.includes('Leave seat')],
    expected: [true, false],
  });
});

test('only the host of an open room is offered Close room, behind a confirm', () => {
  const html = (view: RoomView) =>
    renderToStaticMarkup(header(view, assemblySnapshot.hostActorId));
  assert({
    given:
      'the host of a room being set up, then of a started room, then a guest',
    should:
      'post the close command from a confirm, only while the room is open',
    actual: [
      html(assemblySnapshot).includes('value="close"'),
      html(assemblySnapshot).includes('Close room for everyone'),
      html({ ...assemblySnapshot, status: 'started' }).includes('Close room'),
      renderToStaticMarkup(
        header(
          {
            ...seated,
            capabilities: { ...seated.capabilities, host: false },
          },
          'v'.repeat(24),
        ),
      ).includes('Close room'),
    ],
    expected: [true, true, false, false],
  });
});

test('a host keeps Leave seat apart from Close room, and a seatless host is labelled', () => {
  const hostId = assemblySnapshot.hostActorId!;
  const seatedHost = renderToStaticMarkup(
    header(
      {
        ...seated,
        hostActorId: hostId,
        participants: seated.participants.map((p) => ({
          ...p,
          actorId: hostId,
        })),
      },
      hostId,
    ),
  );
  const seatlessHost = renderToStaticMarkup(header(assemblySnapshot, hostId));
  assert({
    given: 'the host in a seat, then the host without one',
    should:
      'offer the seated host both Leave seat and a separate Close room, and label the seatless host',
    actual: [
      seatedHost.includes('Leave seat'),
      seatedHost.includes('value="leave-seat"'),
      seatedHost.includes('value="close"'),
      seatedHost.includes('not in a seat'),
      seatlessHost.includes('You’re hosting · not in a seat'),
      seatlessHost.includes('Leave seat'),
    ],
    expected: [true, true, true, false, true, false],
  });
});

test('a room number prefixes the title only when the room has one', () => {
  assert({
    given: 'a room without a number, then one numbered 4',
    should: 'render nothing extra, then Room 4 before the name',
    actual: [
      renderToStaticMarkup(header(seated, 'v'.repeat(24))).includes('Room 4'),
      renderToStaticMarkup(header(seated, 'v'.repeat(24), 4)).includes(
        'Room 4 · ',
      ),
    ],
    expected: [false, true],
  });
});

test('the resolution is labelled as the resolution', () => {
  const html = renderToStaticMarkup(<RoomResolution view={seated} />);
  assert({
    given: 'a room topic',
    should:
      'show it under a Resolution heading with what each side argues, and no Edit for a guest',
    actual: [
      html.includes('>Resolution</h2>'),
      html.includes(seated.topic),
      html.includes('argues for it'),
      html.includes('argues against it'),
      html.includes('>Edit<'),
    ],
    expected: [true, true, true, true, false],
  });
});
