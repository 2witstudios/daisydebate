import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { RoomSettings } from './room-settings';

setupRitewayBun();
const guestView = {
  ...assemblySnapshot,
  capabilities: { ...assemblySnapshot.capabilities, canEdit: false },
};

test('saved schedule preserves the pinned asymmetric order and precise durations', () => {
  const html = renderAccessible(
    <RoomSettings view={guestView} />,
  ).textContent();
  assert({
    given:
      'the saved N3 then A1 rules with an independent millisecond override',
    should:
      'list the actual order by full name and code, with seats and the exact clock',
    actual: [
      html.indexOf('Third negative reply (N3)') <
        html.indexOf('Affirmative opening (A1)'),
      html.includes('Negative 3'),
      html.includes('1:38.765'),
    ],
    expected: [true, true, true],
  });
});

test('the summary reads in words and never shows the raw format id', () => {
  const html = renderAccessible(
    <RoomSettings view={guestView} />,
  ).textContent();
  assert({
    given: 'saved preparation and interaction settings',
    should: 'summarize every value in the room vocabulary',
    actual: [
      [
        '2v3 · about',
        '5:21',
        '14:47 per side',
        '0:00.444',
        'Interruptions',
        'Ending a speech early',
      ].every((value) => html.includes(value)),
      html.includes('test-unequal-template'),
      html.includes('revision'),
    ],
    expected: [true, false, false],
  });
});

test('only the host is offered Edit settings, where focus returns when it closes', () => {
  const customize = (canEdit: boolean) => {
    const view = renderAccessible(
      <RoomSettings
        view={{
          ...assemblySnapshot,
          capabilities: { ...assemblySnapshot.capabilities, canEdit },
        }}
      />,
    );
    // data-room-setup-home is the contract room-setup-modal returns focus to.
    return view.has('link', 'Edit settings')
      ? [
          view.attribute('link', 'Edit settings', 'href'),
          view.attribute('link', 'Edit settings', 'data-room-setup-home'),
        ]
      : null;
  };
  assert({
    given: 'the host, then a guest',
    should:
      'link the host to Edit settings and give the guest the preview alone',
    actual: [customize(true), customize(false)],
    expected: [['#room-setup', ''], null],
  });
});
