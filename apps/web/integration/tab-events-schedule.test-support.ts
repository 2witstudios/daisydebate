import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import type { HostEventsView } from '@daisy/protocol/lobby/host-events-read';
import type { LobbyCommandReceipt } from '@daisy/protocol/lobby/command';
import {
  eventFormEnvelope,
  type EventFormContext,
} from '../src/features/tab/event-form';
import type { TabPrincipal } from '../src/features/tab/tab-principal';
/** Actual bound schedule fields run through the production lobby HTTP dispatch selected by the caller. */
export async function proveEventScheduleForms(input: {
  readonly read: (
    principal: TabPrincipal,
    lobbyId: string,
  ) => Promise<HostEventsView | null>;
  readonly send: (
    principal: TabPrincipal,
    envelope: unknown,
  ) => Promise<
    | { kind: 'accepted'; receipt: LobbyCommandReceipt }
    | { kind: 'refused'; refusal: string }
  >;
  readonly principal: TabPrincipal;
  readonly lobbyId: string;
  readonly eventId: string;
  readonly handle: string;
}) {
  const view = async () => {
    const current = await input.read(input.principal, input.lobbyId);
    if (!current) throw new Error('The actual Events read is absent');
    return current;
  };
  const fields = (values: Readonly<Record<string, string>>) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(values)) form.set(key, value);
    form.set('lobbyId', createId());
    return form;
  };
  const post = async (target: EventFormContext['target'], form: FormData) => {
    const current = await view();
    const envelope = eventFormEnvelope(
      {
        handle: input.handle,
        lobbyId: input.lobbyId,
        returnEventId: input.eventId,
        commandId: createId(),
        lobbyVersion: current.lobbyVersion,
        target,
      },
      form,
    );
    const answer = await input.send(input.principal, envelope);
    if (answer.kind !== 'accepted')
      throw new Error(`Actual schedule form refused: ${answer.refusal}`);
    return answer;
  };
  await post(
    { kind: 'add-stage', eventId: input.eventId },
    fields({
      stageKind: 'preliminary',
      place: 'online',
      timing: 'live',
      division: '',
    }),
  );
  await post(
    { kind: 'add-resolution', pools: [] },
    fields({
      poolId: '',
      poolName: 'Authoring pool',
      text: 'Public libraries should be open on Sundays.',
    }),
  );
  let current = await view();
  const stage = current.setup.events.find(
    (event) => event.eventId === input.eventId,
  )!.stages[0]!;
  const word = current.resolutionChoices.find(
    (choice) => choice.resolution.poolResolutionId !== null,
  )!;
  if (!word) throw new Error('The real authored resolution source is absent');
  await post(
    {
      kind: 'add-round',
      stageId: stage.stageId,
      resolutionChoices: current.resolutionChoices,
    },
    fields({ name: 'Round one', resolution: word.key }),
  );
  await post(
    { kind: 'add-slot' },
    fields({ name: 'Authoring slot', startsAt: '2027-03-06T09:00' }),
  );
  current = await view();
  const round = current.setup.events.find(
      (event) => event.eventId === input.eventId,
    )!.tabRounds[0]!,
    slot = current.setup.timeSlots[0]!;
  await post(
    {
      kind: 'place-round',
      tabRoundId: round.tabRoundId,
      timeSlots: current.setup.timeSlots.map((slot) => ({
        timeSlotId: slot.timeSlotId,
        name: slot.name,
      })),
    },
    fields({ timeSlotId: slot.timeSlotId }),
  );
  current = await view();
  await post(
    {
      kind: 'edit-round',
      tabRoundId: round.tabRoundId,
      resolutionChoices: current.resolutionChoices,
    },
    fields({ name: 'Renamed round', resolution: word.key }),
  );
  current = await view();
  assert({
    given: 'real stage, wording, Round and time-slot forms through HTTP',
    should:
      'preserve actual generated identities, fixed wording pin and slot assignment when the Round is renamed',
    actual: current.setup.events
      .find((event) => event.eventId === input.eventId)!
      .tabRounds.map((row) => [
        row.tabRoundId,
        row.name,
        row.resolutionPoolId,
        row.poolResolutionId,
        row.timeSlotId,
      ]),
    expected: [
      [
        round.tabRoundId,
        'Renamed round',
        word.resolution.poolId,
        word.resolution.poolResolutionId,
        slot.timeSlotId,
      ],
    ],
  });
  const context = {
    handle: input.handle,
    lobbyId: input.lobbyId,
    returnEventId: input.eventId,
    commandId: createId(),
    lobbyVersion: current.lobbyVersion,
    target: {
      kind: 'edit-slot' as const,
      timeSlotId: slot.timeSlotId,
      slotVersion: current.timeSlotVersions.find(
        (row) => row.timeSlotId === slot.timeSlotId,
      )!.version,
    },
  };
  const form = fields({ name: 'Updated slot', startsAt: '2027-03-06T09:30' }),
    envelope = eventFormEnvelope(context, form);
  const updated = await input.send(input.principal, envelope),
    stale = await input.send(input.principal, {
      ...envelope,
      commandId: createId(),
    });
  const after = await view();
  const staleSlot = await input.send(input.principal, {
    ...envelope,
    commandId: createId(),
    expected: { ...envelope.expected, lobby: after.lobbyVersion },
  });
  assert({
    given: 'two distinct slot commands from the same displayed guards',
    should:
      'accept one and refuse the stale one while preserving the actual stored slot identity',
    actual: [
      updated.kind,
      stale,
      staleSlot,
      after.setup.timeSlots.map((row) => [
        row.timeSlotId,
        row.name,
        row.startsAt,
      ]),
    ],
    expected: [
      'accepted',
      { kind: 'refused', refusal: 'version-conflict' },
      { kind: 'refused', refusal: 'version-conflict' },
      [[slot.timeSlotId, 'Updated slot', '2027-03-06T09:30:00.000Z']],
    ],
  });
}
