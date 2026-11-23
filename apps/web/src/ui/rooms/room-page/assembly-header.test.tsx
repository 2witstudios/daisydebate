import { idle } from '../../../features/forms/form-state';
import type { RoomView } from '@daisy/protocol/room-contract';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  assemblySnapshot,
  pendingInvitation,
} from '../../../features/rooms/assembly.test-support';
import { initialInvitationForm } from '../../../features/room-invitations/submit';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { byText, findElements } from '../../test-support/find-elements';
import { AssemblyHeader, RoomResolution } from './assembly-header';
import { RoomInvite } from './room-invite';

setupRitewayBun();

/** The fields a submit button posts with its form. */
const posted = (button: Element) => {
  const form = (button as HTMLButtonElement).form;
  return Object.fromEntries(
    [...(form?.querySelectorAll('input[name]') ?? [])].map((input) => [
      (input as HTMLInputElement).name,
      (input as HTMLInputElement).value,
    ]),
  );
};
/** The command types every form in the output posts. */
const commandTypes = (view: ReturnType<typeof renderAccessible>) =>
  view
    .all('button', undefined, { hidden: true })
    .map((button) => posted(button)['type'])
    .filter((type) => type !== undefined);
/** Node.DOCUMENT_POSITION_FOLLOWING; the DOM globals are not installed here. */
const DOCUMENT_POSITION_FOLLOWING = 4;
const action = async () => idle();
const header = (view: RoomView, actorId: string, roomNumber?: number) =>
  AssemblyHeader({
    view,
    actorId,
    ...(roomNumber === undefined ? {} : { roomNumber }),
    commandIds: { close: 'close-id' },
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
      seat: { kind: 'side', side: 'negative', slot: 0 } as const,
      teamOpen: false,
      positionOpen: false,
      rating: null,
      ageBand: null,
      needsReady: true,
      ready: 'not-ready' as const,
      eligible: true,
    },
  ],
  capabilities: { ...assemblySnapshot.capabilities, canEdit: false },
};

test('the room name is the page title, with status and meta lines and no badges', () => {
  const tree = header(seated, 'v'.repeat(24));
  const view = renderAccessible(tree);
  const text = view.textContent();
  assert({
    given: 'a seated guest in an assembling casual team room',
    should:
      'title the page with the room name, say status and meta in words, offer invite, and leave Leave seat to the roster row and settings to Edit settings (ADR 0145)',
    actual: [
      byText(tree, 'h1', seated.title)?.type,
      text.includes('1 of 6 seats filled'),
      text.includes('Casual'),
      text.includes(seated.topic),
      findElements(tree, (element) => element.type === RoomInvite)[0]?.props
        .label,
      view.has('button', 'Leave seat', { hidden: true }),
      text.includes('Room setup'),
    ],
    expected: ['h1', true, true, false, 'Copy invite link', false, false],
  });
});

test('the host has no seat to leave, and settings live off the header (ADR 0145)', () => {
  const view = renderAccessible(
    header(assemblySnapshot, assemblySnapshot.hostActorId),
  );
  assert({
    given: 'the host before taking a seat',
    should: 'offer neither Leave seat nor a header Room setup button',
    actual: [
      view.has('button', 'Room setup', { hidden: true }),
      view.textContent().includes('Leave seat'),
    ],
    expected: [false, false],
  });
});

test('only the host of an open room is offered Close room, behind a confirm', () => {
  const render = (view: RoomView) =>
    renderAccessible(header(view, assemblySnapshot.hostActorId));
  assert({
    given:
      'the host of a room being set up, then of a started room, then a guest',
    should:
      'post the close command from a confirm, only while the room is open',
    actual: [
      posted(
        render(assemblySnapshot).get('button', 'Close room for everyone', {
          hidden: true,
        }),
      )['type'],
      render({ ...assemblySnapshot, status: 'started' })
        .textContent()
        .includes('Close room'),
      renderAccessible(
        header(
          {
            ...seated,
            capabilities: { ...seated.capabilities, host: false },
          },
          'v'.repeat(24),
        ),
      )
        .textContent()
        .includes('Close room'),
    ],
    expected: ['close', false, false],
  });
});

test('Close room is a dialog, not a dropdown', () => {
  const view = renderAccessible(
    header(assemblySnapshot, assemblySnapshot.hostActorId),
  );
  // A closed dialog's aria-labelledby name is not computed (the heading is
  // hidden with it), so the test checks the dialog the heading labels.
  const closeTitle = view.get('heading', 'Close this room for everyone?', {
    hidden: true,
  });
  assert({
    given: 'the host’s assembling room',
    should: 'open the close confirm as a dialog with no dropdown',
    actual: [
      view.attribute('button', 'Close room', 'aria-haspopup'),
      view
        .all('dialog', undefined, { hidden: true })
        .some(
          (dialog) =>
            dialog.getAttribute('aria-labelledby') === closeTitle.id &&
            dialog.contains(closeTitle),
        ),
      view
        .all('group', undefined, { hidden: true })
        .some((group) => group.tagName === 'DETAILS'),
    ],
    expected: ['dialog', true, false],
  });
});

test('only the host of an open room is offered Invite people, as a dialog in the button row', () => {
  const render = (view: RoomView) =>
    renderAccessible(header(view, assemblySnapshot.hostActorId));
  const offersInvite = (view: RoomView) =>
    render(view).textContent().includes('Invite people');
  const invited = {
    ...assemblySnapshot,
    invitations: [pendingInvitation],
  };
  const guest = {
    ...invited,
    capabilities: { ...invited.capabilities, host: false },
  };
  const buttons = render(invited);
  const inviteTrigger = buttons.get('button', /^Invite people \(1/);
  const inviteDialog = buttons
    .all('dialog', undefined, { hidden: true })
    .find(
      (dialog) =>
        dialog.getAttribute('aria-labelledby') ===
        buttons.get('heading', /^Invite people/, { hidden: true }).id,
    );
  assert({
    given:
      'the host of a room being set up with one pending invitation, then of a ready room, a started room and a closed room, then a guest',
    should:
      'offer Invite people with the count after Copy invite link, opening a dialog that holds the pending invitation, only to the host while the room is open',
    actual: [
      inviteTrigger.getAttribute('aria-haspopup'),
      inviteDialog?.textContent?.includes('@coach · invited to judge'),
      Boolean(
        buttons
          .get('link', 'Copy invite link')
          .compareDocumentPosition(inviteTrigger) & DOCUMENT_POSITION_FOLLOWING,
      ),
      offersInvite({ ...invited, status: 'ready' }),
      offersInvite({ ...invited, status: 'started' }),
      offersInvite({ ...invited, status: 'closed' }),
      offersInvite(guest),
    ],
    expected: ['dialog', true, true, true, false, false, false],
  });
});

test('a seated host keeps Close room, and a seatless host is labelled', () => {
  const hostId = assemblySnapshot.hostActorId!;
  const seatedHost = renderAccessible(
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
  const seatedText = seatedHost.textContent();
  const seatedCommands = commandTypes(seatedHost);
  const seatlessHost = renderAccessible(header(assemblySnapshot, hostId));
  assert({
    given: 'the host in a seat, then the host without one',
    should:
      'offer the seated host Close room (Leave is on their roster row), and label the seatless host',
    actual: [
      seatedText.includes('Leave seat'),
      seatedCommands.includes('leave-seat'),
      seatedCommands.includes('close'),
      seatedText.includes('not in a seat'),
      seatlessHost.textContent().includes('You’re hosting · not in a seat'),
      seatlessHost.textContent().includes('Leave seat'),
    ],
    expected: [false, false, true, false, true, false],
  });
});

test('a room number prefixes the title only when the room has one', () => {
  assert({
    given: 'a room without a number, then one numbered 4',
    should: 'render nothing extra, then Room 4 before the name',
    actual: [
      renderAccessible(header(seated, 'v'.repeat(24)))
        .textContent()
        .includes('Room 4'),
      renderAccessible(header(seated, 'v'.repeat(24), 4)).text(
        'heading',
        undefined,
        {
          level: 1,
        },
      ),
    ],
    expected: [false, `Room 4 · ${seated.title}`],
  });
});

test('the resolution is labelled as the resolution', () => {
  const view = renderAccessible(<RoomResolution view={seated} />);
  const text = view.textContent();
  assert({
    given: 'a room topic',
    should:
      'show it under a Resolution heading with what each side argues, and no Edit for a guest',
    actual: [
      view.has('heading', 'Resolution', { level: 2 }),
      text.includes(seated.topic),
      text.includes('argues for it'),
      text.includes('argues against it'),
      view.has('button', 'Edit', { hidden: true }) ||
        view.has('link', 'Edit', { hidden: true }),
    ],
    expected: [true, true, true, true, false],
  });
});

test('the header names no lobby, only that the Room is ranked (YRoomPreRound)', () => {
  const youth = renderAccessible(
    header(
      { ...seated, competitionType: 'ranked', ageRule: 'under-18' },
      'v'.repeat(24),
    ),
  );
  assert({
    given: 'a ranked Room in the Youth lobby',
    should: 'read Listed in the lobby · Ranked, with no ladder badge',
    actual: [
      youth.textContent().includes('Listed in the lobby · Ranked'),
      youth.textContent().includes('Youth') ||
        youth.textContent().includes('Freestyle'),
    ],
    expected: [true, false],
  });
});

test('a held fixed resolution has tournament release copy', () => {
  const view = { ...seated, topic: null };
  const text = renderAccessible(<RoomResolution view={view} />).textContent();
  assert({
    given: 'a fixed-resolution Room whose wording is held',
    should: 'say the tournament has yet to release the resolution',
    actual: [
      text.includes('Waiting for the tournament to release the resolution'),
      text.includes('Chosen by strike before the round'),
    ],
    expected: [true, false],
  });
});
