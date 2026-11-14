import type {
  SetupEvent,
  TournamentSetupView,
} from '@daisy/protocol/lobby/lobby-setup-read';
import type { ResolvedSettingsView } from '@daisy/protocol/lobby/resolved-settings-read';
import type { SettingKey } from '@daisy/protocol/setting-values';
import { linkTo, sampleAction, type Choice, type TabAction } from './action';
import { daysBefore } from './organization';
import { resolvedEntry } from './reads/resolved-settings';
import { sampleSetup } from './sample/setup';
import type { SampleScene } from './sample/scene';
import {
  lockedSetting,
  lockedWithView,
  openSetting,
  settingLineOf,
  type SettingLine,
  type SettingLineCopy,
} from './settings';

/** How hard the engine tries to keep a pairing or judging policy. */
type PolicyForce = 'rule' | 'preference' | 'warning' | 'off';

export type PairingPolicy = {
  readonly key: string;
  readonly label: string;
  readonly force: PolicyForce;
  /** A preference's place in the order preferences give way. */
  readonly rank: number | null;
};

/** A host picks a preset; only an organization sets force key by key. */
type PairingPanel = {
  readonly preset: Choice;
  /** What the chosen preset does, before the policies it comes with. */
  readonly summary: string;
  readonly policies: readonly PairingPolicy[];
  /** Who may set a policy's force one by one. */
  readonly forceNote: string;
  readonly save: TabAction;
};

/** Which event a host screen shows, and the way to each of the others. */
export type EventSwitch = {
  readonly current: string;
  readonly position: string;
  readonly others: readonly TabAction[];
};

export type TournamentSetup = {
  readonly event: EventSwitch;
  readonly lede: string;
  readonly settings: readonly SettingLine[];
  readonly pairing: PairingPanel;
};

/**
 * What one setup line shows: a pin of the template the event follows, its
 * stages, one or more setting keys (the first decides source and lock), its
 * resolution rule against its pool, or its sanction.
 */
type SetupLineCopy =
  | (SettingLineCopy & { readonly subject: 'format' | 'ballot.definition' })
  | (SettingLineCopy & { readonly subject: 'stages' })
  | (SettingLineCopy & {
      readonly subject: 'setting';
      readonly keys: readonly [SettingKey, ...SettingKey[]];
    })
  | (SettingLineCopy & {
      readonly subject: 'resolutions';
      /** Where the event's resolutions are added and changed. */
      readonly resolutions: string;
    })
  | {
      readonly subject: 'sanction';
      readonly label: string;
    };

/** The words the setup screen uses, beyond what its reads carry. */
export type SetupCopy = {
  readonly lines: readonly SetupLineCopy[];
  readonly pairing: PairingPanel;
};

/** The reads one event's setup is drawn from: the tournament's, and the event's settings. */
export type TournamentSetupReads = {
  readonly setup: TournamentSetupView;
  readonly eventId: string;
  readonly settings: ResolvedSettingsView;
};
export type TournamentSetupContext = {
  readonly event: EventSwitch;
  readonly now: string;
  readonly copy: SetupCopy;
};

/** Resolutions an event's prelims need from its pool: one per round, or a draw's worth. */
function resolutionsNeeded(event: SetupEvent, settings: ResolvedSettingsView) {
  const rule = resolvedEntry(settings, 'resolution.rule')?.value as
    { readonly method: string; readonly drawSize?: number } | undefined;
  const preliminary = new Set(
    event.stages
      .filter((stage) => stage.kind === 'preliminary')
      .map((stage) => stage.stageId),
  );
  const rounds = event.tabRounds.filter((round) =>
    preliminary.has(round.stageId),
  );
  return rounds.length * (rule?.method === 'strike' ? (rule.drawSize ?? 1) : 1);
}

const agoWords = (days: number) =>
  days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;

type LineSource = SettingLine['source'];
type SettingCopy<Subject extends SetupLineCopy['subject']> = Extract<
  SetupLineCopy,
  { readonly subject: Subject }
>;

/** A pin of the template the event follows: locked, set by its owner. */
function pinLine(
  copy: SettingCopy<'format' | 'ballot.definition'>,
  event: SetupEvent,
  lobby: LineSource,
): SettingLine {
  const view = copy.view ?? null;
  const control =
    event.template === null
      ? openSetting(copy.edit ?? null)
      : view === null
        ? lockedSetting
        : lockedWithView(view);
  return {
    keys: copy.keys,
    label: copy.label,
    value: copy.value,
    source:
      event.template === null
        ? lobby
        : { scope: 'organization', name: event.template.organization.name },
    control,
    attention: null,
  };
}

/** The resolution rule, and what the event's pool still lacks for its prelims. */
function resolutionsLine(
  copy: SettingCopy<'resolutions'>,
  reads: TournamentSetupReads,
  event: SetupEvent,
): readonly SettingLine[] {
  const entry = resolvedEntry(reads.settings, 'resolution.rule');
  if (entry === null) return [];
  const poolId = event.tabRounds.find(
    (round) => round.resolutionPoolId !== null,
  )?.resolutionPoolId;
  const pool = reads.setup.resolutionPools.find(
    (candidate) => candidate.resolutionPoolId === poolId,
  );
  const needed = resolutionsNeeded(event, reads.settings);
  const short = pool !== undefined && pool.size < needed;
  return [
    settingLineOf(entry, {
      ...copy,
      edit: linkTo(short ? 'Add resolutions' : 'Change', copy.resolutions),
      attention: short ? `the pool has ${pool.size}, needs ${needed}` : null,
    }),
  ];
}

/** The league the event asks to count for, and how long its request has waited. */
function sanctionLine(
  copy: SettingCopy<'sanction'>,
  event: SetupEvent,
  lobby: LineSource,
  now: string,
): readonly SettingLine[] {
  const sanction = event.sanction;
  if (sanction === null) return [];
  const waiting = sanction.status === 'requested';
  return [
    {
      keys: ['sanction'],
      label: copy.label,
      value: sanction.organization.name,
      source: lobby,
      control: openSetting(waiting ? sampleAction('View request') : null),
      attention: waiting
        ? `sanction requested ${agoWords(daysBefore(sanction.requestedAt, now))}, not yet answered`
        : null,
    },
  ];
}

/**
 * Tournament setup for one event: its lines from the resolved-settings view
 * asked at the event, its template's pins, its stages, its resolution pool
 * and its sanction, from the tournament's setup read.
 */
function tournamentSetupOf(
  reads: TournamentSetupReads,
  context: TournamentSetupContext,
): TournamentSetup | null {
  const event = reads.setup.events.find(
    (candidate) => candidate.eventId === reads.eventId,
  );
  if (event === undefined) return null;
  const lobby: LineSource = { scope: 'lobby', name: reads.setup.name };
  const line = (copy: SetupLineCopy): readonly SettingLine[] => {
    switch (copy.subject) {
      case 'format':
      case 'ballot.definition':
        return [pinLine(copy, event, lobby)];
      case 'stages':
        return [
          {
            keys: copy.keys,
            label: copy.label,
            value: copy.value,
            source: lobby,
            control: openSetting(copy.edit ?? null),
            attention: null,
          },
        ];
      case 'setting': {
        const entry = resolvedEntry(reads.settings, copy.keys[0]);
        return entry === null ? [] : [settingLineOf(entry, copy)];
      }
      case 'resolutions':
        return resolutionsLine(copy, reads, event);
      case 'sanction':
        return sanctionLine(copy, event, lobby, context.now);
    }
  };
  return {
    event: context.event,
    lede:
      event.template === null
        ? `${event.name}. Rooms inherit all of this and can't change it.`
        : `${event.name}. Follows ${event.template.organization.name}'s template; rooms inherit all of this and can't change it.`,
    settings: context.copy.lines.flatMap(line),
    pairing: context.copy.pairing,
  };
}

export const readSetup = (
  slug: string,
  scene: SampleScene,
): TournamentSetup | null => {
  const sample = sampleSetup(slug, scene);
  return sample === null
    ? null
    : tournamentSetupOf(sample.reads, sample.context);
};
