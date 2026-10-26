import type { RoomView } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { byText, findElements } from '../../test-support/find-elements';
import { AssemblyCommandFields } from './assembly-command-fields';
import { AssemblyDetails } from './assembly-details';
import { AssemblyHeader } from './assembly-header';
import { RoomInvite } from './room-invite';

setupRitewayBun();
const action = async () => ({ values: {} });
const header = (view: RoomView, actorId: string) =>
  AssemblyHeader({
    view,
    actorId,
    commandIds: { details: 'details-id', leave: 'leave-id', close: 'close-id' },
    detailsAction: action,
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

test('header carries the room chips, invite and the seated viewer’s leave', () => {
  const tree = header(seated, 'v'.repeat(24));
  assert({
    given: 'a seated guest in an assembling casual team room',
    should:
      'show status, shape and type chips, invite, Leave seat, and no edit form',
    actual: [
      Boolean(byText(tree, 'span', 'Before the round')),
      Boolean(byText(tree, 'span', '2 v 3')),
      Boolean(byText(tree, 'span', 'Casual')),
      findElements(tree, (element) => element.type === RoomInvite)[0]?.props
        .label,
      Boolean(byText(tree, 'button', 'Leave seat')),
      findElements(tree, (element) => element.type === AssemblyDetails).length,
    ],
    expected: [true, true, true, 'Copy invite link', true, 0],
  });
});

test('the host edits details and closes the Room instead of leaving a seat', () => {
  const hostId = assemblySnapshot.hostActorId!;
  const hostSeated = {
    ...seated,
    hostActorId: hostId,
    participants: seated.participants.map((p) => ({ ...p, actorId: hostId })),
  };
  const closeFields = (tree: ReturnType<typeof header>) =>
    findElements(tree, (element) => element.type === AssemblyCommandFields).map(
      (element) => [element.props.type, element.props.commandId],
    );
  assert({
    given: 'the host before taking a seat, and the host in a seat',
    should:
      'offer details editing and a Close room form posting close, never Leave seat',
    actual: [
      Boolean(byText(header(assemblySnapshot, hostId), 'button', 'Leave seat')),
      findElements(
        header(assemblySnapshot, hostId),
        (element) => element.type === AssemblyDetails,
      ).length,
      Boolean(byText(header(hostSeated, hostId), 'button', 'Close room')),
      Boolean(byText(header(hostSeated, hostId), 'button', 'Leave seat')),
      closeFields(header(hostSeated, hostId)),
    ],
    expected: [false, 1, true, false, [['close', 'close-id']]],
  });
});
