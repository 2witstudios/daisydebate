import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { eventAside, storedEventsSchedule } from '../../../features/tab/events';
import { eventFormEnvelope } from '../../../features/tab/event-form';
import { sampleAutumnSetup } from '../../../features/tab/test-support/sample/setup';
import { SlotFields } from './event-command-fields';
import type { HostEventsView } from '@daisy/protocol/lobby/host-events-read';
setupRitewayBun();
const id = (name: string) => name.padEnd(24, 'x');
const setup = sampleAutumnSetup({
  viewer: 'host',
  moment: 'before',
  scale: 'normal',
});
const view = (value = setup): HostEventsView => ({
  setup: value,
  lobbyVersion: 1,
  timeSlotVersions: value.timeSlots.map((slot) => ({
    timeSlotId: slot.timeSlotId,
    version: 1,
  })),
  pinOptions: [],
  resolutionChoices: [],
});
test('Events aside uses only none, create and persisted edit identity', () => {
  const event = setup.events[0]!;
  const renamed = {
    ...setup,
    events: setup.events.map((row) => ({ ...row, name: 'Renamed' })),
  };
  const edit = eventAside(renamed, { create: false, eventId: event.eventId });
  assert({
    given:
      'no selection, explicit create, a renamed persisted event and ambiguous or absent identities',
    should:
      'keep the three states explicit and retain the actual ID after rename',
    actual: [
      eventAside({ ...setup, events: [] }, { create: false, eventId: null })
        ?.kind,
      eventAside({ ...setup, events: [] }, { create: true, eventId: null })
        ?.kind,
      edit?.kind,
      edit?.kind === 'edit' ? edit.event.eventId : null,
      eventAside(setup, { create: true, eventId: event.eventId }),
      eventAside(setup, { create: false, eventId: id('unknown') }),
    ],
    expected: ['none', 'create', 'edit', event.eventId, null, null],
  });
});
test('a bridge event joins every time-slot group it connects', () => {
  const [first, second] = setup.timeSlots;
  if (!first || !second) throw new Error('Expected sample time slots');
  const base = setup.events[0]!,
    round = base.tabRounds[0]!;
  const make = (name: string, slots: readonly string[]) => ({
    ...base,
    eventId: id(name),
    name,
    tabRounds: slots.map((timeSlotId, index) => ({
      ...round,
      tabRoundId: id(`${name}${index}`),
      number: index + 1,
      timeSlotId,
    })),
  });
  const current = {
    ...setup,
    events: [
      make('A', [first.timeSlotId]),
      make('B', [second.timeSlotId]),
      make('C', [first.timeSlotId, second.timeSlotId]),
    ],
  };
  const projected = storedEventsSchedule(view(current));
  assert({
    given: 'two separate slot groups and an event that shares both',
    should:
      'produce one connected group with actual ID links and explicitly unconfigured policies',
    actual: [
      projected.groups.map((group) =>
        group.events.map((event) => event.slug).sort(),
      ),
      projected.entryLimit.kind,
      projected.judgePool.kind,
    ],
    expected: [[[id('A'), id('B'), id('C')]], 'unconfigured', 'unconfigured'],
  });
});
test('slot authoring preserves displayed subsecond UTC instants', () => {
  const instant = '2027-03-06T09:30:47.125Z';
  const html = renderToStaticMarkup(
    <SlotFields name="Slot" startsAt={instant} />,
  );
  const form = new FormData();
  form.set('name', 'Renamed');
  form.set('startsAt', instant.slice(0, -1));
  const encoded = eventFormEnvelope(
    {
      handle: 'actual',
      lobbyId: id('lobby'),
      returnEventId: null,
      commandId: id('command'),
      lobbyVersion: 3,
      target: { kind: 'edit-slot', timeSlotId: id('slot'), slotVersion: 4 },
    },
    form,
  );
  assert({
    given:
      'a stored UTC slot with nonzero seconds and milliseconds and a name-only edit',
    should:
      'display and retain the complete instant and its original slot guard',
    actual: [
      html.includes('2027-03-06T09:30:47.125'),
      html.includes('step="0.001"'),
      encoded.expected,
      encoded.command.type === 'update-time-slot'
        ? encoded.command.startsAt
        : null,
    ],
    expected: [true, true, { lobby: 3, timeSlot: 4 }, instant],
  });
});
