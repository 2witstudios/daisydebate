import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ballotFields } from './fields';
setupRitewayBun();
import { ballotFormFixture as fields } from './ballot-form.test-support';
test('strict native ballot preserves one envelope and refuses impersonation, duplicate and stale low-point confirmation', () => {
  const valid = fields();
  const parsed = ballotFields(valid);
  const attacks: FormData[] = [];
  for (const [key, value] of [
    ['actorId', 'a'.repeat(24)],
    ['outcome', 'affirmative'],
    ['commandId', 'd'.repeat(24)],
  ]) {
    const form = fields();
    form.append(key!, value!);
    attacks.push(form);
  }
  const low = fields();
  low.set('affirmative-thesis', '1');
  low.set('low-point', 'affirmative:30:30');
  attacks.push(low);
  assert({
    given:
      'one native envelope and untrusted claims, duplicate id or outdated confirmation',
    should: 'accept only the strict current ballot',
    actual: [parsed.ok, attacks.map((form) => ballotFields(form).ok)],
    expected: [true, [false, false, false, false]],
  });
});
