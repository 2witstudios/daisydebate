import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ballotFields } from './fields';
setupRitewayBun();
import {
  ballotFormFixture as fields,
  ballotFormPlan as plan,
} from './ballot-form.test-support';
import { ballotPlanFor } from '../judge/ballot-plan';
import { sampleBallotRound } from '../judge/ballot-plan.test-support';
import { daisyWinnerBallot } from '@daisy/protocol';
test('strict native ballot preserves one envelope and refuses impersonation, duplicate and stale low-point confirmation', () => {
  const valid = fields();
  const parsed = ballotFields(valid, plan);
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
    actual: [parsed.ok, attacks.map((form) => ballotFields(form, plan).ok)],
    expected: [true, [false, false, false, false]],
  });
});

test('a missing winner names the actual Round debaters without accepting them as authority', () => {
  const form = fields();
  form.delete('winner');
  const [aff, neg] = sampleBallotRound.participants;
  const actual = ballotPlanFor(
    {
      ...sampleBallotRound,
      participants: [
        { ...aff!, label: 'Actual Affirmative' },
        { ...neg!, label: 'Actual Negative' },
      ],
    },
    daisyWinnerBallot,
  );
  const result = ballotFields(form, actual, true);
  assert({
    given: 'fresh canonical display names and no chosen side',
    should: 'name both actual debaters in the refusal',
    actual: result.ok ? null : result.error,
    expected: 'Pick who won: Actual Affirmative or Actual Negative.',
  });
});
