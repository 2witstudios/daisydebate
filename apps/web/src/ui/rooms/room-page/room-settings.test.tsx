import { renderToStaticMarkup } from 'react-dom/server';
import type { RoomView } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { findElements } from '../../test-support/find-elements';
import { AssemblySettingsForm } from './assembly-settings-form';
import { RoomSettings } from './room-settings';

setupRitewayBun();
const action = async () => ({ values: {} });
const guestView = {
  ...assemblySnapshot,
  capabilities: { ...assemblySnapshot.capabilities, canEdit: false },
};

test('saved schedule preserves the pinned asymmetric order and precise durations', () => {
  const html = renderToStaticMarkup(
    <RoomSettings view={guestView} commandId="c" action={action} />,
  );
  assert({
    given:
      'the saved N3 then A1 rules with an independent millisecond override',
    should:
      'render the actual order, seats and exact clock without a symmetric template',
    actual: [
      html.indexOf('Third negative reply') <
        html.indexOf('Affirmative opening'),
      html.includes('Negative 3'),
      html.includes('1:38.765'),
      html.includes('test-unequal-template · revision 7'),
    ],
    expected: [true, true, true, true],
  });
});

test('saved settings summary and the host edit form', () => {
  const html = renderToStaticMarkup(
    <RoomSettings view={guestView} commandId="c" action={action} />,
  );
  const editForms = (view: RoomView) =>
    findElements(
      RoomSettings({ view, commandId: 'c', action }),
      (element) => element.type === AssemblySettingsForm,
    ).length;
  assert({
    given: 'saved preparation and interaction settings, for host and guest',
    should: 'summarize every value and offer editing to the host alone',
    actual: [
      ['5:21', '14:47 each', '0:00.444', 'Free', 'Yield'].every((value) =>
        html.includes(value),
      ),
      editForms(assemblySnapshot),
      editForms(guestView),
    ],
    expected: [true, 1, 0],
  });
});
