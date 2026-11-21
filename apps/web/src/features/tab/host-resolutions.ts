import type { SettingValues } from '@daisy/protocol/setting-values';
import type { HostEventsView } from '@daisy/protocol/lobby/host-events-read';
import { commandAction, linkTo } from './action';
import type { EventFormContext } from './event-form';
import { hostRoutes } from './routes';
import { releaseAudiences } from '@daisy/protocol/release-audience';
import { audienceLabels } from './results';
import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import { releaseAudienceSchema } from '@daisy/protocol/release-audience';
import { releaseCommandEnvelopeSchema } from '@daisy/protocol/lobby/result-command';

export const roundReleaseContext = z.strictObject({
  lobbyId: idSchema,
  handle: z.string().regex(/^[a-z0-9-]{1,64}$/),
  eventId: idSchema,
  tabRoundId: idSchema,
  commandId: idSchema,
  audience: releaseAudienceSchema.optional(),
});
export type RoundReleaseContext = z.infer<typeof roundReleaseContext>;

export const roundReleaseEnvelope = ({
  eventId,
  tabRoundId,
  commandId,
  audience,
}: RoundReleaseContext) =>
  releaseCommandEnvelopeSchema.parse({
    version: 1,
    commandId,
    expected: {},
    command:
      audience === undefined
        ? { type: 'release-resolution', tabRoundId }
        : {
            type: 'open-audience',
            thing: 'posting',
            eventId,
            audience,
            tabRounds: { kind: 'one', tabRoundId },
          },
  });

export function hostResolutions(
  view: HostEventsView,
  eventId: string,
  nextId: () => string,
  rule: SettingValues['resolution.rule'] | null,
  posting?: SettingValues['audience.posting'],
) {
  const { setup, lobbyVersion, resolutionChoices } = view;
  const event = setup.events.find((one) => one.eventId === eventId);
  if (!event) return null;
  const pools = setup.resolutionPools;
  const bind = <Target extends EventFormContext['target']>(
    label: string,
    target: Target,
  ) =>
    commandAction<Omit<EventFormContext, 'target'> & { target: Target }>(
      label,
      {
        handle: setup.handle,
        lobbyId: setup.lobbyId,
        lobbyVersion,
        commandId: nextId(),
        returnEventId: eventId,
        returnTo: 'resolutions',
        target,
      },
    );
  return {
    title: event.name,
    releaseRule:
      rule?.method === 'strike'
        ? 'Strike in the Room'
        : rule
          ? `${rule.method === 'fixed' ? 'Fixed wording' : 'Draw from pool'} · ${rule.release === 'manual' ? 'Manual release' : 'Release with posting'}`
          : null,
    back: linkTo(
      'Event settings',
      `${hostRoutes.setup(setup.handle)}?event=${eventId}`,
    ),
    tabs: setup.events.map((one) => ({
      id: one.eventId,
      label: one.name,
      href: hostRoutes.resolutions(setup.handle, one.eventId),
      selected: one.eventId === eventId,
    })),
    resolutions: resolutionChoices.flatMap((choice) => {
      if (!choice.wording) return [];
      return [
        {
          id: choice.key,
          title:
            choice.wording.kind === 'shown'
              ? choice.wording.text
              : 'Wording held until release',
          pool: choice.label,
        },
      ];
    }),
    add: bind('Add resolution', {
      kind: 'add-resolution',
      pools: pools.map(({ resolutionPoolId, name }) => ({
        poolId: resolutionPoolId,
        name,
      })),
    }),
    rounds: event.tabRounds.map((round) => {
      const published =
        view.publishedRoundIds?.includes(round.tabRoundId) ?? false;
      const audience =
        view.postingReleases && posting && published
          ? releaseAudiences.find(
              (audience) =>
                !view.postingReleases?.some(
                  (opened) =>
                    opened.tabRoundId === round.tabRoundId &&
                    opened.audience === audience,
                ),
            )
          : undefined;
      return {
        id: round.tabRoundId,
        title: round.name ?? `Round ${round.number}`,
        name: round.name,
        selected: round.poolResolutionId
          ? `word:${round.poolResolutionId}`
          : round.resolutionPoolId
            ? `pool:${round.resolutionPoolId}`
            : '',
        released:
          view.releasedResolutionRoundIds?.includes(round.tabRoundId) ?? false,
        release:
          rule &&
          rule.method !== 'strike' &&
          rule.release === 'manual' &&
          !view.releasedResolutionRoundIds?.includes(round.tabRoundId) &&
          (round.poolResolutionId ||
            (rule.method === 'draw' && round.resolutionPoolId))
            ? commandAction(
                'Release resolution',
                {
                  lobbyId: setup.lobbyId,
                  handle: setup.handle,
                  eventId,
                  tabRoundId: round.tabRoundId,
                  commandId: nextId(),
                },
                true,
              )
            : null,
        openPosting:
          audience && posting?.[audience] === 'manual'
            ? commandAction(
                `Open posting · ${audienceLabels[audience]}`,
                {
                  lobbyId: setup.lobbyId,
                  handle: setup.handle,
                  eventId,
                  tabRoundId: round.tabRoundId,
                  commandId: nextId(),
                  audience,
                },
                true,
              )
            : null,
        save: published
          ? null
          : bind('Save round', {
              kind: 'edit-round',
              tabRoundId: round.tabRoundId,
              resolutionChoices,
            }),
      };
    }),
  };
}
