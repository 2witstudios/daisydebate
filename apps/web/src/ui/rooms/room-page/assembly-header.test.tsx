import type { RoomView } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { byText, findElements } from '../../test-support/find-elements';
import { AssemblyDetails } from './assembly-details';
import { AssemblyHeader } from './assembly-header';
import { RoomInvite } from './room-invite';

setupRitewayBun();
const action = async () => ({ values: {} });
const header = (view: RoomView, actorId: string) =>
  AssemblyHeader({
    view,
    actorId,
    commandIds: { details: 'details-id', leave: 'leave-id' },
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
      Boolean(byText(tree, 'span', '2 v 3 · Full')),
      Boolean(byText(tree, 'span', 'Casual')),
      findElements(tree, (element) => element.type === RoomInvite)[0]?.props
        .label,
      Boolean(byText(tree, 'button', 'Leave seat')),
      findElements(tree, (element) => element.type === AssemblyDetails).length,
    ],
    expected: [true, true, true, 'Copy invite link', true, 0],
  });
});

test('an unseated host edits details and has no seat to leave', () => {
  const tree = header(assemblySnapshot, assemblySnapshot.hostActorId);
  assert({
    given: 'the host before taking a seat',
    should: 'offer room details editing without Leave seat',
    actual: [
      Boolean(byText(tree, 'button', 'Leave seat')),
      findElements(tree, (element) => element.type === AssemblyDetails).length,
    ],
    expected: [false, 1],
  });
});
