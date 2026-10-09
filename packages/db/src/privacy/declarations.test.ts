import { assert, setupRitewayBun, test } from 'riteway/bun';
import { validatePrivacyAdoption } from './declarations';
import type { PrivacyFieldDeclaration } from './contracts';

setupRitewayBun();
const field: PrivacyFieldDeclaration = {
  table: 'sample',
  column: 'body',
  category: 'personal',
  visibility: 'private',
  storage: 'postgres',
  owner: 'MSG',
  purpose: 'Requested communication',
  lawfulBasis: { status: 'pending', decision: 'DEC-124' },
  retention: { status: 'pending', decision: 'DEC-124' },
  erasure: 'delete',
  exportable: true,
};
const expected = { sample: ['body'] };
test('complete pending declarations hold activation', () => {
  assert({
    given: 'exact fields with explicit pending legal policies',
    should: 'accept declaration completeness and hold activation',
    actual: validatePrivacyAdoption(expected, [field]),
    expected: { problems: [], activationHeld: true },
  });
});
test('adoption rejects missing duplicate stale and invalid fields', () => {
  const cases = [
    [],
    [field, field],
    [{ ...field, column: 'old' }],
    [{ ...field, visibility: undefined }],
    [{ ...field, purpose: '' }],
    [{ ...field, lawfulBasis: undefined }],
    [{ ...field, retention: undefined }],
    [{ ...field, erasure: undefined }],
    [{ ...field, exportable: undefined }],
    [{ ...field, category: 'personal', erasure: 'retain-nonpersonal' }],
  ];
  assert({
    given: 'each missing, duplicate, stale or incomplete policy declaration',
    should: 'report every invalid adoption as held',
    actual: cases.map((fields) => {
      const result = validatePrivacyAdoption(expected, fields);
      return [result.problems.length > 0, result.activationHeld];
    }),
    expected: cases.map(() => [true, true]),
  });
});
test('approved policies can release the declaration hold', () => {
  const approved = {
    status: 'approved',
    decision: 'Recorded decision',
    rule: 'Recorded rule',
  } as const;
  assert({
    given: 'complete approved policies',
    should: 'report no declaration hold',
    actual: validatePrivacyAdoption(expected, [
      { ...field, lawfulBasis: approved, retention: approved },
    ]),
    expected: { problems: [], activationHeld: false },
  });
});

test('canonical dedicated messaging inventory is exact and private fingerprints stay private', async () => {
  const { messagingPrivacyFields, messagingPrivacyExpectedColumns } =
    await import('./messaging-declarations');
  assert({
    given: 'canonical dedicated MSG columns',
    should: 'declare every column while holding unresolved policies',
    actual: validatePrivacyAdoption(
      messagingPrivacyExpectedColumns,
      messagingPrivacyFields,
    ),
    expected: { problems: [], activationHeld: true },
  });
  assert({
    given: 'payload fingerprint and relationship references',
    should: 'protect them as private personal data',
    actual: messagingPrivacyFields
      .filter(
        (field) =>
          (field.table === 'messaging_receipts' &&
            field.column === 'payload_digest') ||
          (field.table === 'messaging_contact_pairs' &&
            field.column.endsWith('actor_id')),
      )
      .map((field) => [field.category, field.visibility, field.erasure]),
    expected: [
      ['personal', 'private', 'delete'],
      ['personal', 'private', 'delete'],
      ['personal', 'private', 'delete'],
    ],
  });
});

test('social request and invitation declarations protect private associations', async () => {
  const { messagingPrivacyFields } = await import('./messaging-declarations');
  const privateColumns = {
    messaging_dm_pairs: ['introduction'],
    messaging_receipts: ['payload_digest'],
    messaging_social_commands: ['actor_id', 'digest', 'result_channel_id'],
    messaging_group_invitations: [
      'channel_id',
      'invitee_actor_id',
      'invited_by_actor_id',
      'generation',
      'state',
      'invited_at',
      'decided_at',
    ],
  };
  const protectedFields = Object.entries(privateColumns).flatMap(
    ([table, columns]) =>
      columns.map((column) =>
        messagingPrivacyFields.find(
          (field) => field.table === table && field.column === column,
        ),
      ),
  );
  assert({
    given:
      'private introduction, nullable fingerprints and social associations',
    should:
      'require private personal deletion without approved policy exceptions',
    actual: protectedFields.map((field) => [
      field?.category,
      field?.visibility,
      field?.erasure,
      field?.lawfulBasis.status,
      field?.retention.status,
    ]),
    expected: protectedFields.map(() => [
      'personal',
      'private',
      'delete',
      'pending',
      'pending',
    ]),
  });
  assert({
    given: 'typed private-group invitation channel witness',
    should: 'classify its fixed channel kind as nonpersonal metadata',
    actual: messagingPrivacyFields.find(
      (field) =>
        field.table === 'messaging_group_invitations' &&
        field.column === 'channel_kind',
    )?.category,
    expected: 'none',
  });
});
