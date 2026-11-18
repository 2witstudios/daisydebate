import type { SQL } from 'bun';
import { activeRoomMembers, closeRoom, eraseSeats } from '@daisy/debate-engine';
import { subjectRightsVerificationBindings } from '@daisy/db/privacy';
import { assert } from 'riteway/bun';
import { seedHostingGrant } from './tab-hosting-grant.test-support';
import type { withRoomRuntime } from './room-runtime.test-support';

type Runtime = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];

/** Full canonical export/erasure over genuine selected funding provenance. */
export const proveCaptureSubjectRights = async (input: {
  readonly f: Runtime;
  readonly owner: SQL;
  readonly roundId: string;
  readonly hostingVersionId: string;
  readonly funder: { readonly userId: string; readonly actorId: string };
  readonly official: { readonly userId: string; readonly actorId: string };
}) => {
  const { f, owner, roundId, hostingVersionId, funder, official } = input;
  const transitions = { activeRoomMembers, closeRoom, eraseSeats };
  const unused = await owner.begin((sql) =>
    seedHostingGrant(sql, funder.userId, { replaceCurrent: true }),
  );
  const [before] =
    await owner`select admission from tournament_capture_admissions where round_id=${roundId}`;
  const exports = await Promise.all(
    [funder, official, f.outsider].map((subject) =>
      f.store.exportPrivacySubject(subject, transitions),
    ),
  );
  const [fundingExport, officialExport, otherExport] = exports;
  assert({
    given:
      'actual selected capture/sponsorship source plus an unused replacement and three independently scoped subjects',
    should:
      'export each own audit role and funding source, exclude another payer source body from official export and reveal no unrelated tenant record',
    actual: [
      fundingExport!.account_hosting_versions?.map((row) => row.id),
      fundingExport!.tournament_capture_admissions?.map((row) => [
        row.round_id,
        row.funding_account,
        row.acting_official,
      ]),
      officialExport!.tournament_capture_admissions?.map((row) => [
        row.round_id,
        row.funding_account,
        row.acting_official,
        row.hosting_version_id,
      ]),
      otherExport!.tournament_capture_admissions,
      otherExport!.tournament_sponsorship_versions,
      JSON.stringify(officialExport!.tournament_capture_admissions).includes(
        hostingVersionId,
      ),
    ],
    expected: [
      [hostingVersionId, unused],
      [[roundId, true, false]],
      [[roundId, false, true, null]],
      [],
      [],
      false,
    ],
  });
  const erased = await f.store.erasePrivacySubject(
    { subject: funder, now: new Date().toISOString(), vendors: [], jobIds: [] },
    transitions,
    subjectRightsVerificationBindings,
  );
  const [after] =
    await owner`select admission from tournament_capture_admissions where round_id=${roundId}`;
  const [counts] =
    await owner`select (select count(*)::int from account_entitlement_grants where user_id=${funder.userId}) as grants,(select count(*)::int from account_hosting_versions where id=${hostingVersionId}) as selected,(select count(*)::int from account_hosting_versions where id=${unused}) as unused,(select count(*)::int from tournament_sponsorship_versions where sponsor_user_id=${funder.userId}) as sponsorships`;
  assert({
    given:
      'the full canonical funding-account erasure composition after physical settlement',
    should:
      'erase live entitlements and unused source detail while preserving exact selected provenance, consent history and competitive admission',
    actual: [
      erased.alreadyErased,
      counts!.grants,
      counts!.selected,
      counts!.unused,
      counts!.sponsorships,
      JSON.stringify(before!.admission) === JSON.stringify(after!.admission),
    ],
    expected: [false, 0, 1, 0, 2, true],
  });
};
