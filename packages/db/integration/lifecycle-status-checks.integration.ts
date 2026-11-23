import { SQL } from 'bun';
import { assert, test } from 'riteway/bun';
import { betaAccessStates } from '@daisy/protocol/beta-access';
import { recordingJobStatuses } from '@daisy/protocol/recording-processing';
import { recordingStatuses } from '@daisy/protocol/recording';
import { roomInvitationStates } from '@daisy/protocol/room-invitations';
import { roomStatuses } from '@daisy/protocol/room-contract';
import { roundStatuses, runningRoundStatuses } from '@daisy/protocol/round';
import { storedFriendshipStates } from '@daisy/protocol/friends';
import { contentReportStatuses } from '@daisy/protocol/content-moderation';
import { flagStates } from '@daisy/protocol/flags';
import {
  guardianInvitationStatuses,
  guardianLinkStatuses,
} from '@daisy/protocol/guardians';
import {
  ballotScreeningStatuses,
  drawStatuses,
  entryStatuses,
  fixtureStatuses,
  membershipStatuses,
  pendingCommandStatuses,
  sanctionStatuses,
  tournamentJudgeStatuses,
  tournamentStatuses,
} from '@daisy/protocol/lobby';
import { leagueSchoolStatuses } from '@daisy/protocol/lobby/league-school-command';
import { profilePhotoStatuses } from '@daisy/protocol/public-profile';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { ballotScreenings } from '../src/schema/ballot-screenings';
import { accountBetaAccess } from '../src/schema/beta-access';
import { pendingCommands } from '../src/schema/conflicts';
import { contentReports } from '../src/schema/content-moderation';
import { draws } from '../src/schema/draws';
import { entries } from '../src/schema/entries';
import { fixtures } from '../src/schema/fixtures';
import { releaseFlags } from '../src/schema/flags';
import { friendships } from '../src/schema/friends';
import {
  childAccountRequests,
  guardianLinks,
} from '../src/schema/guardian-links';
import { leagueSchools } from '../src/schema/league-schools';
import { tournaments } from '../src/schema/lobbies';
import { memberships } from '../src/schema/organizations';
import { profilePhotos } from '../src/schema/public-profiles';
import { recordingProcessingJobs } from '../src/schema/recording-processing-jobs';
import { recordings } from '../src/schema/recordings';
import { roomInvitations } from '../src/schema/room-invitations';
import { sanctions } from '../src/schema/sanctions';
import { tournamentJudges } from '../src/schema/tournament-judges';
import { rooms } from '../src/schema/rooms';
import { rounds } from '../src/schema/rounds';
import { integrationSuite } from './suite.test-support';

const { databaseUrl } = integrationSuite();

// Direct membership CHECKs whose persisted status or state is protocol-owned.
for (const [table, name, column, statuses] of [
  [rooms, 'rooms_status_check', 'status', roomStatuses],
  [rounds, 'rounds_status_check', 'status', roundStatuses],
  [recordings, 'recordings_status_check', 'status', recordingStatuses],
  [
    recordingProcessingJobs,
    'recording_jobs_status_check',
    'status',
    recordingJobStatuses,
  ],
  [
    roomInvitations,
    'room_invitations_state_check',
    'state',
    roomInvitationStates,
  ],
  [releaseFlags, 'release_flags_state_check', 'state', flagStates],
  [friendships, 'friendships_state', 'state', storedFriendshipStates],
  [
    contentReports,
    'content_reports_status_check',
    'status',
    contentReportStatuses,
  ],
  [
    profilePhotos,
    'profile_photos_status_check',
    'status',
    profilePhotoStatuses,
  ],
  [
    accountBetaAccess,
    'account_beta_access_state_check',
    'state',
    betaAccessStates,
  ],
  [
    guardianLinks,
    'guardian_links_status_check',
    'status',
    guardianLinkStatuses,
  ],
  [
    childAccountRequests,
    'child_requests_status_check',
    'status',
    guardianInvitationStatuses,
  ],
  [tournaments, 'tournaments_status_check', 'status', tournamentStatuses],
  [sanctions, 'sanctions_status_check', 'status', sanctionStatuses],
  [draws, 'draws_status_check', 'status', drawStatuses],
  [entries, 'entries_status_check', 'status', entryStatuses],
  [fixtures, 'fixtures_status_check', 'status', fixtureStatuses],
  [memberships, 'memberships_status_check', 'status', membershipStatuses],
  [
    leagueSchools,
    'league_schools_status_check',
    'status',
    leagueSchoolStatuses,
  ],
  [
    pendingCommands,
    'pending_commands_status_check',
    'status',
    pendingCommandStatuses,
  ],
  [
    ballotScreenings,
    'ballot_screenings_status_check',
    'status',
    ballotScreeningStatuses,
  ],
  [
    tournamentJudges,
    'tournament_judges_status_check',
    'status',
    tournamentJudgeStatuses,
  ],
] as const) {
  const tableName = getTableConfig(table).name;
  test(`${name} accepts the protocol statuses in schema and PostgreSQL`, async () => {
    const check = getTableConfig(table).checks.find(
      (item) => item.name === name,
    );
    if (!check) throw new Error(`Missing schema CHECK ${name}`);
    const literalList = statuses.map((status) => `'${status}'`);
    assert({
      given: `the Drizzle definition of ${name}`,
      should: 'render a status membership CHECK with the exact protocol list',
      actual: new PgDialect().sqlToQuery(check.value),
      expected: {
        sql: `"${tableName}"."${column}" in (${literalList.join(', ')})`,
        params: [],
      },
    });

    const sql = new SQL(databaseUrl, { max: 1 });
    try {
      const actual = await sql<{ definition: string; validated: boolean }[]>`
        select pg_get_constraintdef(c.oid) as definition, c.convalidated as validated
        from pg_constraint c
        where c.conrelid = to_regclass(${`public.${tableName}`})
          and c.contype = 'c' and c.conname = ${name}
      `;
      assert({
        given: `the migrated definition of ${name}`,
        should: 'validate the exact same membership CHECK',
        actual: Array.from(actual),
        expected: [
          {
            definition: `CHECK ((${column} = ANY (ARRAY[${literalList.map((value) => `${value}::text`).join(', ')}])))`,
            validated: true,
          },
        ],
      });
    } finally {
      await sql.close();
    }
  });
}

test('installed nonranked capture admission uses the running Round statuses', async () => {
  const sql = new SQL(databaseUrl, { max: 1 });
  try {
    const rows = await sql<{ definition: string | null }[]>`
      select pg_get_functiondef(to_regprocedure(
        'public.daisy_nonranked_capture_capacity(text,text,text,text)'
      )) as definition
    `;
    const definition = rows[0]?.definition ?? '';
    const statusLists = [
      ...definition.matchAll(/\br\.status\s+in\s*\(([^)]+)\)/gi),
    ].map(([, values]) =>
      [...(values ?? '').matchAll(/'([^']+)'/g)].map(([, value]) => value),
    );
    assert({
      given: 'the installed tenant-boundary capacity function',
      should: 'count the exact protocol vocabulary for a running Round',
      actual: statusLists,
      expected: [[...runningRoundStatuses]],
    });
  } finally {
    await sql.close();
  }
});
