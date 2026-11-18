import { systemId } from '@daisy/clock';
import type { CommandExpected } from '@daisy/protocol/lobby/command';
import {
  drawOverrideSchema,
  type DrawCommand,
} from '@daisy/protocol/lobby/draw-command';
import {
  hostDrawOverviewSchema,
  hostRoundViewSchema,
} from '@daisy/protocol/lobby/draw-read';
import { notFound } from 'next/navigation';
import { randomBytes } from 'node:crypto';
import { readOwnRoute } from '../../../../../../../../(shell)/friends/read-route';
import { linkTo } from '../../../../../../../../../features/tab/action';
import { drawBoardOf } from '../../../../../../../../../features/tab/draw';

import {
  hostDrawOverviewPath,
  hostRoundPath,
} from '../../../../../../../../../features/tab/host-draw-route';
import { hostNavigationRail } from '../../../../../../../../../features/tab/host-navigation';
import { requireTabRelease } from '../../../../../../../../../features/tab/release';
import { hostRoutes } from '../../../../../../../../../features/tab/routes';
import { runningRoundOf } from '../../../../../../../../../features/tab/tab-round';

import {
  controlClass,
  fieldClass,
  labelClass,
} from '../../../../../../../../../ui/components/form-field/form-field-class';
import { PageHeader } from '../../../../../../../../../ui/components/page-header/page-header';
import { ReplayCommandForm } from '../../../../../../../../../ui/form-action/replay-command-form';
import { DrawBoard } from '../../../../../../../../../ui/tab/draw-board/draw-board';
import { HostShell } from '../../../../../../../../../ui/tab/host-shell/host-shell';
import { RunningRound } from '../../../../../../../../../ui/tab/running-round/running-round';
import { GET as overviewGET } from '../../../../../../../../api/tab/host-draw/route';
import { GET } from '../../../../../../../../api/tab/host-round/route';
import { readStoredHostNavigation } from '../../../../../../read-navigation';
import { drawAction } from '../../../../draw-actions';

export async function StoredRound({
  handle,
  eventId,
  tabRoundId,
  selectedFixtureId,
}: {
  readonly handle: string;
  readonly eventId: string;
  readonly tabRoundId: string;
  readonly selectedFixtureId: string | null;
}) {
  await requireTabRelease();
  const navigation = await readStoredHostNavigation('lobby', handle);
  if (!navigation) notFound();
  const event = navigation.events.find((row) => row.eventId === eventId);
  if (!event) notFound();
  const read = await readOwnRoute(
    GET,
    hostRoundPath({ lobbyId: navigation.id, eventId, tabRoundId }),
    hostRoundViewSchema,
  );
  const overview = await readOwnRoute(
    overviewGET,
    hostDrawOverviewPath(navigation.id),
    hostDrawOverviewSchema,
  );
  if (!read || !overview) notFound();
  const rail = hostNavigationRail(navigation),
    address = hostRoutes.round(handle, eventId, tabRoundId);
  const expected: CommandExpected = {
    ...(read.guards.draw === null ? {} : { draw: read.guards.draw }),
    entries: read.guards.entries,
    settings: read.guards.settings,
    results: read.guards.results,
    ...(read.guards.timeSlot === null
      ? {}
      : { timeSlot: read.guards.timeSlot }),
  };
  const form = (
    label: string,
    command: DrawCommand,
    overrideKeys: readonly string[] = [],
  ) => {
    const keys = overrideKeys.map((key) =>
      drawOverrideSchema.shape.key.parse(key),
    );
    return (
      <ReplayCommandForm
        key={label}
        label={label}
        submitLabel={label}
        action={drawAction.bind(null, {
          handle,
          lobbyId: navigation.id,
          eventId,
          tabRoundId,
          envelope: {
            version: 1,
            commandId: systemId.next(),
            expected,
            command,
          },
          overrideKeys: keys,
        })}
      >
        {keys.map((key) => (
          <label key={key} className={fieldClass}>
            <span className={labelClass}>
              Reason to override {key.replaceAll('_', ' ').replaceAll('.', ' ')}
            </span>
            <input
              name={`override:${key}`}
              required
              maxLength={500}
              className={controlClass}
            />
          </label>
        ))}
      </ReplayCommandForm>
    );
  };
  const generation = () =>
    form(read.kind === 'undrawn' ? 'Generate draw' : 'Draw again', {
      type: 'generate-draw',
      tabRoundId,
      resultCutoff: Math.max(0, read.tabRound.number - 1),
      seed: randomBytes(32).toString('hex'),
    });
  const eventSwitch = {
    current: event.name,
    position: read.tabRound.name ?? `Round ${read.tabRound.number}`,
    others: overview.events
      .filter((row) => row.eventId !== eventId)
      .map((other) => {
        const round =
          other.rounds.find((row) => row.number === read.tabRound.number) ??
          other.rounds[0];
        return linkTo(
          other.name,
          round
            ? hostRoutes.round(handle, other.eventId, round.tabRoundId)
            : hostRoutes.tournament(handle),
        );
      }),
  };
  if (read.kind === 'undrawn')
    return (
      <HostShell rail={rail} current="draw">
        <PageHeader
          title={read.tabRound.name ?? `Round ${read.tabRound.number}`}
          lede={`${event.name} · No draw has been generated.`}
        />
        {read.capabilities.generate ? generation() : null}
      </HostShell>
    );
  if (read.kind === 'published')
    return (
      <RunningRound
        rail={rail}
        current="draw"
        round={runningRoundOf(read.round, {
          event: eventSwitch,
          address: {
            posting: address,
            tournament: hostRoutes.tournament(handle),
            nextDraw: read.round.next
              ? hostRoutes.round(handle, eventId, read.round.next.tabRoundId)
              : null,
          },
          wallClock: (at) =>
            new Intl.DateTimeFormat('en', {
              timeZone: 'UTC',
              hour: '2-digit',
              minute: '2-digit',
            }).format(new Date(at)) + ' UTC',
          overviewAction: linkTo('Draw', hostRoutes.tournament(handle)),
          fixtureAction: (fixture) =>
            fixture.room
              ? linkTo('Open room', `/rooms/${fixture.room.roomId}`)
              : linkTo(
                  'Results',
                  `${hostRoutes.results(handle)}?event=${eventId}`,
                ),
        })}
      />
    );
  const chosen = read.draw.recordGroups
    .flatMap((group) => group.fixtures)
    .find((row) => row.fixtureId === selectedFixtureId);
  const keys = [
    ...new Set(
      read.draw.recordGroups.flatMap((group) =>
        group.fixtures.flatMap((fixture) =>
          fixture.findings
            .filter((finding) => finding.severity === 'rule_broken')
            .map((finding) => finding.text),
        ),
      ),
    ),
  ];
  const controls = (
    <div className="flex flex-wrap items-start gap-4">
      {read.capabilities.generate ? generation() : null}
      {read.draw.capabilities.edit
        ? form('Assign judges', {
            type: 'assign-judges',
            drawId: read.draw.draw.drawId,
          })
        : null}
      {read.draw.capabilities.publish
        ? form(
            `Publish round ${read.tabRound.number}`,
            {
              type: 'publish-draw',
              drawId: read.draw.draw.drawId,
              overrides: [],
            },
            keys,
          )
        : null}
      {read.draw.capabilities.edit
        ? form('Discard draft', {
            type: 'discard-draft',
            drawId: read.draw.draw.drawId,
          })
        : null}
    </div>
  );
  const seats = chosen ? (
    <div className="flex flex-col gap-3">
      {chosen.entries.map((entry) => (
        <p key={entry.entryId}>
          {entry.side ? `${entry.side}: ` : ''}
          {entry.name}
        </p>
      ))}
      {chosen.judges.map((judge) => (
        <p key={judge.tournamentJudgeId}>
          {judge.chair ? 'Chair' : 'Judge'}: {judge.name}
        </p>
      ))}
      {chosen.kind === 'pairing' && read.draw.capabilities.edit
        ? form('Swap sides', {
            type: 'edit-draw',
            basedOnDrawId: read.draw.draw.drawId,
            edits: [{ type: 'swap-sides', fixtureId: chosen.fixtureId }],
          })
        : null}
    </div>
  ) : null;
  return (
    <DrawBoard
      rail={rail}
      current="draw"
      draw={drawBoardOf(read.draw, {
        event: eventSwitch,
        selectedFixtureId,
        fixtureAddress: (fixtureId) =>
          hostRoutes.round(handle, eventId, tabRoundId, fixtureId),
      })}
      storedControls={{ actions: controls, seats }}
    />
  );
}
