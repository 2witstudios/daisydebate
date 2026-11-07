import { assert, setupRitewayBun, test } from 'riteway/bun';
import { decideFlagChange } from './change';
import { flagCatalogue } from './catalogue';

setupRitewayBun();
test('operator changes require current revisions and live release targeting', () => {
  const now = Date.parse('2026-11-05T00:00:00Z');
  const input = {
    entry: flagCatalogue[0],
    revision: 2,
    expectedRevision: 2,
    now,
  };
  const override = (expiresAt: string) => ({
    action: 'flag.override.update' as const,
    accountId: 'a'.repeat(24),
    override: { enabled: true, expiresAt },
  });
  assert({
    given:
      'a state change, stale revision, expired override, override after release expiry and valid target',
    should: 'accept only fresh revisions and bounded live targeting',
    actual: [
      decideFlagChange({
        ...input,
        change: { action: 'flag.state.update', state: 'killed' },
      }),
      decideFlagChange({
        ...input,
        expectedRevision: 1,
        change: { action: 'flag.state.update', state: 'enabled' },
      }),
      decideFlagChange({ ...input, change: override('2026-11-05T00:00:00Z') }),
      decideFlagChange({ ...input, change: override('2027-01-01T00:00:00Z') }),
      decideFlagChange({ ...input, change: override('2026-11-06T00:00:00Z') }),
    ],
    expected: [
      { kind: 'apply', revision: 3 },
      { kind: 'refused', reason: 'CONFLICT' },
      { kind: 'refused', reason: 'VALIDATION' },
      { kind: 'refused', reason: 'VALIDATION' },
      { kind: 'apply', revision: 3 },
    ],
  });
});
