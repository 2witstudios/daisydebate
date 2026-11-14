import { ageAdmitted } from '@daisy/auth/authorization';
import type {
  LoadedEntryEnrollment,
  EntryEnrollmentCommand,
} from '@daisy/db/tab';
import { resolveSetting } from '@daisy/protocol/setting-resolution';
import type { EntryFacts, EntryPersonFacts } from '../commands/entries';
import { CommandDenied } from '../commands/run-command';
import { eventSettingChain } from './setting-chains';
import { settingRow } from './setting-facts';
import { formatSettingDefaults } from './format-setting-defaults';

export const entryEnrollmentFacts = (
  loaded: LoadedEntryEnrollment,
  input: {
    readonly commandId: string;
    readonly newEntryId: string;
    readonly now: string;
    readonly senderUserId: string;
    readonly host: boolean;
    readonly command: EntryEnrollmentCommand;
  },
): EntryFacts => {
  const { event, graph } = loaded;
  if (!event) throw new CommandDenied('not-found');
  const chain = eventSettingChain(graph, event);
  const rows = graph.settings.map(settingRow);
  const format = formatSettingDefaults(
    graph,
    event.formatId,
    event.formatVersion,
  );
  const registration = resolveSetting(
    'entry.registration',
    chain,
    rows,
    format,
  ).value;
  const divisions = resolveSetting('entry.divisions', chain, rows, format).value
    .items;
  const slots = new Set(
    loaded.rounds
      .filter(
        (round) => round.eventId === event.id && round.timeSlotId !== null,
      )
      .map((round) => round.timeSlotId),
  );
  const overlapping = new Set(
    loaded.rounds
      .filter(
        (round) => round.eventId !== event.id && slots.has(round.timeSlotId),
      )
      .map((round) => round.eventId),
  );
  const people: EntryPersonFacts[] = loaded.people.map((person) => ({
    actorId: person.actorId,
    userId: person.userId,
    minor: person.account?.ageBand !== 'adult',
    withinAgeBand: Boolean(
      person.account?.member &&
      !person.account.erased &&
      ageAdmitted(person.account.ageBand),
    ),
    divisions: divisions
      .filter(
        (division) =>
          division.eligibility.kind !== 'prior_entries_at_most' ||
          person.previousEntries.filter(
            (entry) =>
              entry.status === 'accepted' && entry.entryId !== loaded.entry?.id,
          ).length <= division.eligibility.count,
      )
      .map((division) => division.key),
    enteredInEvent: loaded.members.some(
      (member) =>
        member.actorId === person.actorId &&
        member.eventId === event.id &&
        member.entryStatus !== 'withdrawn' &&
        member.entryId !== loaded.entry?.id,
    ),
    enteredInSharedSlot:
      loaded.members.some(
        (member) =>
          member.actorId === person.actorId &&
          member.entryStatus === 'accepted' &&
          overlapping.has(member.eventId),
      ) ||
      loaded.seatedJudges.some(
        (judge) =>
          judge.actorId === person.actorId && slots.has(judge.timeSlotId),
      ),
    // Enrollment behind the closed minors gate does not reconstruct a guardian's provenance.
    boundary: null,
  }));
  const responsible =
    input.command.type === 'submit-entry' ? input.command.responsible : null;
  return {
    commandId: input.commandId,
    now: input.now,
    newEntryId: input.newEntryId,
    event: {
      id: event.id,
      lobbyId: event.lobbyId,
      entriesVersion: event.entriesVersion,
      divisions: divisions.map((division) => division.key),
      approval: resolveSetting('entry.approval', chain, rows, format).value
        .value,
      entryCap: resolveSetting('entry.cap', chain, rows, format).value.perEvent,
      entryCount: loaded.entries.filter(
        (entry) => entry.eventId === event.id && entry.status !== 'withdrawn',
      ).length,
      registration:
        registration.state === 'window'
          ? registration
          : {
              opensAt: null,
              closesAt: registration.state === 'closed' ? input.now : null,
            },
      started: loaded.draws.some(
        (draw) => draw.eventId === event.id && draw.status === 'published',
      ),
    },
    sender: { userId: input.senderUserId, host: input.host },
    people,
    responsible:
      responsible?.kind === 'school'
        ? { ...responsible, found: loaded.schoolAuthorization !== null }
        : responsible?.kind === 'guardian'
          ? loaded.guardian
            ? {
                ...responsible,
                guardianUserId: loaded.guardian.guardianUserId,
                minorUserId: loaded.guardian.minorUserId,
                active: loaded.guardian.status === 'active',
              }
            : null
          : responsible,
    entry: loaded.entry
      ? {
          id: loaded.entry.id,
          status: loaded.entry.status,
          division: loaded.entry.division,
          responsibleKind: loaded.entry.responsibleKind,
          guardianUserId: loaded.guardian?.guardianUserId ?? null,
          submittedByUserId: null,
          version: loaded.entry.version,
          members: people,
          liveFixtures: [],
          breakChoice: { open: false, qualified: [] },
        }
      : null,
  };
};
