import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { systemId } from '@daisy/clock';
import { hostEventsViewSchema } from '@daisy/protocol/lobby/host-events-read';
import { requireTabRelease } from '../../../../../../features/tab/release';
import { hostEventsPath } from '../../../../../../features/tab/host-events-route';
import {
  eventAside,
  storedEventsSchedule,
} from '../../../../../../features/tab/events';
import { hostNavigationRail } from '../../../../../../features/tab/host-navigation';
import { hostRoutes } from '../../../../../../features/tab/routes';
import { linkTo } from '../../../../../../features/tab/action';
import type { EventFormContext } from '../../../../../../features/tab/event-form';
import { EventsSchedule } from '../../../../../../ui/tab/events-schedule/events-schedule';
import {
  EventMetadataFields,
  StageFields,
  RoundFields,
  SlotFields,
  ResolutionFields,
} from '../../../../../../ui/tab/events-schedule/event-command-fields';
import { ReplayCommandForm } from '../../../../../../ui/form-action/replay-command-form';
import { ActionButton } from '../../../../../../ui/tab/action-control/action-control';
import {
  ListCard,
  ListHeading,
  ListRow,
} from '../../../../../../ui/tab/list-card/list-card';
import {
  controlClass,
  fieldClass,
  labelClass,
} from '../../../../../../ui/components/form-field/form-field-class';
import { readStoredHostNavigation } from '../../../read-navigation';
import { readOwnRoute } from '../../../../../(shell)/friends/read-route';
import { GET } from '../../../../../api/tab/host-events/route';
import { eventAction } from './actions';

export async function StoredEvents({
  handle,
  eventId,
  create,
}: {
  readonly handle: string;
  readonly eventId: string | null;
  readonly create: boolean;
}) {
  await requireTabRelease();
  const navigation = await readStoredHostNavigation('lobby', handle);
  if (!navigation) notFound();
  const view = await readOwnRoute(
    GET,
    hostEventsPath(navigation.id),
    hostEventsViewSchema,
  );
  if (!view) notFound();
  const aside = eventAside(view.setup, { create, eventId });
  if (!aside) notFound();
  const selected = aside.kind === 'edit' ? aside.event : null;
  const bind = (
    label: string,
    target: EventFormContext['target'],
    children: ReactNode,
  ) => (
    <ReplayCommandForm
      label={label}
      submitLabel={label}
      action={eventAction.bind(null, {
        handle,
        lobbyId: view.setup.lobbyId,
        returnEventId: selected?.eventId ?? null,
        commandId: systemId.next(),
        lobbyVersion: view.lobbyVersion,
        target,
      })}
    >
      {children}
    </ReplayCommandForm>
  );
  const cancel = (
    <ActionButton action={linkTo('Cancel', hostRoutes.events(handle))} />
  );
  const content =
    aside.kind === 'none'
      ? null
      : aside.kind === 'create'
        ? {
            title: 'Add event',
            content: (
              <div className="flex flex-col gap-4">
                <h2 className="font-display text-xl font-bold">Add event</h2>
                {bind(
                  'Create event',
                  { kind: 'create', pinOptions: view.pinOptions },
                  <EventMetadataFields event={null} pins={view.pinOptions} />,
                )}
                {cancel}
              </div>
            ),
          }
        : {
            title: aside.event.name,
            content: (
              <div className="flex flex-col gap-4">
                <h2 className="font-display text-xl font-bold">
                  {aside.event.name}
                </h2>
                {bind(
                  'Save event',
                  {
                    kind: 'edit',
                    eventId: aside.event.eventId,
                    ballotDefinition: aside.event.ballotDefinition
                      ? {
                          id: aside.event.ballotDefinition.ballotDefinitionId,
                          version:
                            aside.event.ballotDefinition
                              .ballotDefinitionVersion,
                        }
                      : null,
                  },
                  <EventMetadataFields
                    event={aside.event}
                    pins={view.pinOptions}
                  />,
                )}
                <ActionButton
                  action={linkTo(
                    'Event settings',
                    `${hostRoutes.setup(handle)}?event=${aside.event.eventId}`,
                  )}
                />
                <ActionButton
                  action={linkTo(
                    'Ballot definition',
                    hostRoutes.ballot(handle, aside.event.eventId),
                  )}
                />
                {bind(
                  'Remove event',
                  {
                    kind: 'command',
                    command: {
                      type: 'remove-event',
                      lobbyId: view.setup.lobbyId,
                      eventId: aside.event.eventId,
                    },
                  },
                  null,
                )}
                {cancel}
              </div>
            ),
          };
  const schedule = (
    <div className="flex flex-col gap-6">
      {selected ? (
        <>
          <ListCard>
            <ListHeading>{selected.name} stages and rounds</ListHeading>
            <div className="flex flex-col gap-6 p-4">
              {selected.stages.map((stage) => (
                <section key={stage.stageId} className="flex flex-col gap-4">
                  <h3 className="font-strong">
                    {stage.kind === 'preliminary'
                      ? 'Preliminary'
                      : 'Elimination'}{' '}
                    · {stage.place === 'online' ? 'Online' : 'In person'} ·{' '}
                    {stage.timing === 'live' ? 'Live' : 'Windowed'}
                    {stage.division ? ` · ${stage.division}` : ''}
                  </h3>
                  {selected.tabRounds
                    .filter((round) => round.stageId === stage.stageId)
                    .map((round) => (
                      <details
                        key={round.tabRoundId}
                        className="flex flex-col gap-3"
                      >
                        <summary className="cursor-pointer font-strong">
                          {round.name ?? `Round ${round.number}`}
                        </summary>
                        <div className="flex flex-col gap-4 py-3">
                          <ActionButton
                            action={linkTo(
                              'Open draw',
                              hostRoutes.round(
                                handle,
                                selected.eventId,
                                round.tabRoundId,
                              ),
                            )}
                          />
                          {bind(
                            'Save round',
                            {
                              kind: 'edit-round',
                              tabRoundId: round.tabRoundId,
                              resolutionChoices: view.resolutionChoices,
                            },
                            <RoundFields
                              name={round.name}
                              selected={
                                round.poolResolutionId
                                  ? `word:${round.poolResolutionId}`
                                  : round.resolutionPoolId
                                    ? `pool:${round.resolutionPoolId}`
                                    : ''
                              }
                              choices={view.resolutionChoices}
                            />,
                          )}
                          {stage.timing === 'live'
                            ? bind(
                                'Place round',
                                {
                                  kind: 'place-round',
                                  tabRoundId: round.tabRoundId,
                                  timeSlots: view.setup.timeSlots.map(
                                    (slot) => ({
                                      timeSlotId: slot.timeSlotId,
                                      name: slot.name,
                                    }),
                                  ),
                                },
                                <label className={fieldClass}>
                                  <span className={labelClass}>Time slot</span>
                                  <select
                                    name="timeSlotId"
                                    className={controlClass}
                                    defaultValue={round.timeSlotId ?? ''}
                                  >
                                    <option value="">No time slot</option>
                                    {view.setup.timeSlots.map((slot) => (
                                      <option
                                        key={slot.timeSlotId}
                                        value={slot.timeSlotId}
                                      >
                                        {slot.name} · {slot.startsAt}
                                      </option>
                                    ))}
                                  </select>
                                </label>,
                              )
                            : null}
                        </div>
                      </details>
                    ))}
                  {bind(
                    'Add round',
                    {
                      kind: 'add-round',
                      stageId: stage.stageId,
                      resolutionChoices: view.resolutionChoices,
                    },
                    <RoundFields
                      name={null}
                      selected=""
                      choices={view.resolutionChoices}
                    />,
                  )}
                </section>
              ))}
              <details>
                <summary className="cursor-pointer font-strong">
                  Add stage
                </summary>
                <div className="py-3">
                  {bind(
                    'Add stage',
                    { kind: 'add-stage', eventId: selected.eventId },
                    <StageFields />,
                  )}
                </div>
              </details>
            </div>
          </ListCard>
        </>
      ) : null}
      <ListCard>
        <ListHeading>Time slots</ListHeading>
        <div className="flex flex-col gap-5 p-4">
          {view.setup.timeSlots.map((slot) => (
            <details key={slot.timeSlotId}>
              <summary className="cursor-pointer font-strong">
                {slot.name} · {slot.startsAt}
              </summary>
              <div className="flex flex-col gap-4 py-3">
                {bind(
                  'Save time slot',
                  {
                    kind: 'edit-slot',
                    timeSlotId: slot.timeSlotId,
                    slotVersion: view.timeSlotVersions.find(
                      (row) => row.timeSlotId === slot.timeSlotId,
                    )!.version,
                  },
                  <SlotFields name={slot.name} startsAt={slot.startsAt} />,
                )}
                {bind(
                  'Remove time slot',
                  {
                    kind: 'command',
                    slotVersion: view.timeSlotVersions.find(
                      (row) => row.timeSlotId === slot.timeSlotId,
                    )!.version,
                    command: {
                      type: 'remove-time-slot',
                      lobbyId: view.setup.lobbyId,
                      timeSlotId: slot.timeSlotId,
                    },
                  },
                  null,
                )}
              </div>
            </details>
          ))}
          <details>
            <summary className="cursor-pointer font-strong">
              Add time slot
            </summary>
            <div className="py-3">
              {bind(
                'Add time slot',
                { kind: 'add-slot' },
                <SlotFields name="" startsAt="" />,
              )}
            </div>
          </details>
        </div>
      </ListCard>
      <ListCard>
        <ListHeading>Resolution sources</ListHeading>
        <ul>
          {view.setup.resolutionPools.map((pool) => (
            <ListRow
              key={pool.resolutionPoolId}
              title={pool.name}
              detail={`${pool.size} active resolutions`}
            />
          ))}
        </ul>
        <details className="p-4">
          <summary className="cursor-pointer font-strong">
            Add resolution
          </summary>
          <div className="py-3">
            {bind(
              'Add resolution',
              {
                kind: 'add-resolution',
                pools: view.setup.resolutionPools.map((pool) => ({
                  poolId: pool.resolutionPoolId,
                  name: pool.name,
                })),
              },
              <ResolutionFields pools={view.setup.resolutionPools} />,
            )}
          </div>
        </details>
      </ListCard>
    </div>
  );
  return (
    <EventsSchedule
      rail={hostNavigationRail(navigation)}
      schedule={storedEventsSchedule(view)}
      stored={{
        aside: content,
        selectedEventId: selected?.eventId ?? null,
        schedule,
      }}
    />
  );
}
