import type { EventCompetitionFacts } from '@daisy/db/tab';
import { audiences, releaseThings } from '@daisy/protocol/lobby';
import type { SettingValues } from '@daisy/protocol/setting-values';
import { eventSettingResolution } from './event-setting-resolution';

type Opening = {
  readonly tabRoundId: string;
  readonly thing: (typeof releaseThings)[number];
  readonly audience: (typeof audiences)[number];
};
type Screening = {
  readonly tabRoundId: string;
  readonly status: 'pending' | 'held' | 'clear';
};
type Cause = Exclude<
  SettingValues['audience.decision'][(typeof audiences)[number]],
  'never' | 'manual'
>;

/** Append-only openings follow actual competition facts, never a current-setting read alone. */
export function competitionReleases(input: {
  readonly competition: EventCompetitionFacts;
  readonly openings: readonly Opening[];
  readonly screenings: readonly Screening[];
  /** True only inside the accepted announcement's own atomic write. */
  readonly announcingBreak: boolean;
  /** The exact latest results the accepted certification is writing now. */
  readonly certifyingResultIds: readonly string[];
}) {
  const facts = input.competition;
  const { settings } = eventSettingResolution(facts.configuration);
  const latest = facts.results.filter(
    (row) =>
      !facts.results.some((other) => other.supersedesResultId === row.id),
  );
  const published = facts.fixtures.filter((row) => row.status === 'published');
  const complete = (roundId: string) => {
    const fixtures = published.filter((row) => row.tabRoundId === roundId);
    return (
      fixtures.length > 0 &&
      fixtures.every((fixture) =>
        latest.some((row) => row.fixtureId === fixture.id),
      )
    );
  };
  const preliminary = facts.rounds.filter((round) =>
    facts.stages.some(
      (stage) => stage.id === round.stageId && stage.kind === 'preliminary',
    ),
  );
  const prelimsEnded =
    preliminary.length > 0 && preliminary.every((round) => complete(round.id));
  const certified = new Set([
    ...facts.certified.map((row) => row.resultId),
    ...input.certifyingResultIds,
  ]);
  const eventCertified =
    published.length > 0 &&
    published.every((fixture) =>
      latest.some(
        (row) => row.fixtureId === fixture.id && certified.has(row.id),
      ),
    );
  const opened: (Opening & { readonly cause: Cause })[] = [];
  for (const round of facts.rounds) {
    for (const thing of releaseThings) {
      if (
        (thing === 'reason' || thing === 'feedback') &&
        input.screenings.some(
          (row) => row.tabRoundId === round.id && row.status !== 'clear',
        )
      )
        continue;
      for (const audience of audiences) {
        const opening = { tabRoundId: round.id, thing, audience };
        if (
          input.openings.some(
            (row) =>
              row.tabRoundId === round.id &&
              row.thing === thing &&
              row.audience === audience,
          )
        )
          continue;
        const when = settings[`audience.${thing}`].value[audience];
        const due =
          when === 'at_once' ||
          (when === 'round_close' && complete(round.id)) ||
          (when === 'prelims_end' && prelimsEnded) ||
          (when === 'break' &&
            (facts.announcements.length > 0 || input.announcingBreak)) ||
          (when === 'certified' && eventCertified);
        if (!due) continue;
        const narrower = audiences.slice(0, audiences.indexOf(audience));
        if (
          !narrower.every((one) =>
            [...input.openings, ...opened].some(
              (row) =>
                row.tabRoundId === round.id &&
                row.thing === thing &&
                row.audience === one,
            ),
          )
        )
          continue;
        opened.push({ ...opening, cause: when });
      }
    }
  }
  const rule = settings['resolution.rule'].value;
  return {
    opened,
    releaseResolutionWithPosting:
      rule.method !== 'strike' && rule.release === 'with_posting',
  };
}
