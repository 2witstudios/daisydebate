import { idle } from '../../../features/forms/form-state';
import type { RoomView } from '@daisy/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  assemblySnapshot,
  pendingInvitation,
} from '../../../features/rooms/assembly.test-support';
import { initialInvitationForm } from '../../../features/room-invitations/submit';
import { byText, findElements } from '../../test-support/find-elements';
import { AssemblyHeader, RoomResolution } from './assembly-header';
import { RoomInvite } from './room-invite';

setupRitewayBun();
const action = async () => idle();
const header = (view: RoomView, actorId: string, roomNumber?: number) =>
  AssemblyHeader({
    view,
    actorId,
    ...(roomNumber === undefined ? {} : { roomNumber }),
    commandIds: { leave: 'leave-id', close: 'close-id' },
    commandAction: action,
    invitationAction: async () => initialInvitationForm,
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
      teamOpen: false,
      positionOpen: false,
      rating: null,
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
      'title the page with the room name, say status and meta in words, offer invite, and leave Leave seat to the roster row and settings to Edit settings (ADR 0145)',
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
    expected: ['h1', true, true, false, 'Copy invite link', false, false],
  });
});

test('the host has no seat to leave, and settings live off the header (ADR 0145)', () => {
  const html = renderToStaticMarkup(
    header(assemblySnapshot, assemblySnapshot.hostActorId),
  );
  assert({
    given: 'the host before taking a seat',
    should: 'offer neither Leave seat nor a header Room setup button',
    actual: [html.includes('>Room setup<'), html.includes('Leave seat')],
    expected: [false, false],
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

test('Close room is a dialog, not a dropdown', () => {
  const html = renderToStaticMarkup(
    header(assemblySnapshot, assemblySnapshot.hostActorId),
  );
  assert({
    given: 'the host’s assembling room',
    should: 'open the close confirm as a dialog with no dropdown',
    actual: [
      html.includes('<dialog'),
      html.includes('aria-labelledby="close-room-title"'),
      html.includes('<details'),
    ],
    expected: [true, true, false],
  });
});

test('only the host of an open room is offered Invite people, as a dialog in the button row', () => {
  const html = (view: RoomView) =>
    renderToStaticMarkup(header(view, assemblySnapshot.hostActorId));
  const invited = {
    ...assemblySnapshot,
    invitations: [pendingInvitation],
  };
  const guest = {
    ...invited,
    capabilities: { ...invited.capabilities, host: false },
  };
  const buttons = html(invited);
  assert({
    given:
      'the host of a room being set up with one pending invitation, then of a ready room, a started room and a closed room, then a guest',
    should:
      'offer Invite people with the count after Copy invite link, opening a dialog that holds the pending invitation, only to the host while the room is open',
    actual: [
      buttons.includes('aria-labelledby="invite-people-title"'),
      buttons.includes('Invite people (1'),
      buttons.includes('@coach · invited to judge'),
      buttons.indexOf('Copy invite link') < buttons.indexOf('Invite people'),
      html({ ...invited, status: 'ready' }).includes('Invite people'),
      html({ ...invited, status: 'started' }).includes('Invite people'),
      html({ ...invited, status: 'closed' }).includes('Invite people'),
      html(guest).includes('Invite people'),
    ],
    expected: [true, true, true, true, true, false, false, false],
  });
});

test('a seated host keeps Close room, and a seatless host is labelled', () => {
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
      'offer the seated host Close room (Leave is on their roster row), and label the seatless host',
    actual: [
      seatedHost.includes('Leave seat'),
      seatedHost.includes('value="leave-seat"'),
      seatedHost.includes('value="close"'),
      seatedHost.includes('not in a seat'),
      seatlessHost.includes('You’re hosting · not in a seat'),
      seatlessHost.includes('Leave seat'),
    ],
    expected: [false, false, true, false, true, false],
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
