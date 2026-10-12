import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  socialAccountsEligible,
  type SocialContactPolicy,
} from './social-policy';
import { adultAccount } from './social.test-support';
setupRitewayBun();
const now = '2026-10-09T00:00:00.000Z';
const bands = ['13-15', '16-17', 'adult'] as const;
const pairs = bands.flatMap((a, i) =>
  bands.slice(i).map((b) => [a, b] as const),
);

test('full-cast eligibility is equivalent for every band policy and diagonal multiplicity', () => {
  const mismatches: unknown[] = [];
  for (let mask = 0; mask < 64; mask++) {
    const allowedBandPairs = pairs.filter((_, i) => (mask & (1 << i)) !== 0);
    const policy = {
      state: 'approved',
      decision: 'test',
      key: 'test',
      revision: 1,
      allowedBandPairs,
    } as const;
    for (let a = 0; a <= 2; a++)
      for (let b = 0; b <= 2; b++)
        for (let c = 0; c <= 2; c++) {
          const cast = [a, b, c].flatMap((count, i) =>
            Array.from({ length: count }, () => bands[i]!),
          );
          const members = cast.map((_, i) => `actor${i}`);
          const accounts = cast.map((band, i) => ({
            ...adultAccount(members[i]!),
            age: { ...adultAccount(members[i]!).age, band },
          }));
          const expected =
            cast.length > 0 &&
            cast.every((band, i) =>
              cast
                .slice(i + 1)
                .every((other) =>
                  allowedBandPairs.some(
                    ([x, y]) =>
                      (band === x && other === y) ||
                      (band === y && other === x),
                  ),
                ),
            );
          if (
            socialAccountsEligible(members, accounts.reverse(), now, policy) !==
            expected
          )
            mismatches.push({ mask, cast });
        }
  }
  assert({
    given:
      'all 64 symmetric eligible-band policies and zero/one/two of each band',
    should: 'preserve complete pairwise decisions including singleton vacuity',
    actual: mismatches,
    expected: [],
  });
});

test('1000 actual full-cast account identities require linear lookup work', () => {
  let identityReads = 0;
  const members = Array.from({ length: 1000 }, (_, i) => `actor${i}`);
  const accounts = members.map((actorId) => {
    const row = adultAccount(actorId);
    return {
      ...row,
      account: {
        ...row.account,
        get actorId() {
          identityReads++;
          return actorId;
        },
      },
    };
  });
  const policy: SocialContactPolicy = {
    state: 'approved',
    decision: 'test',
    key: 'test',
    revision: 1,
    allowedBandPairs: [['adult', 'adult']],
  };
  const allowed = socialAccountsEligible(
    members,
    accounts.reverse(),
    now,
    policy,
  );
  assert({
    given: '1000 distinct current members in reverse fact order',
    should: 'check all current facts without quadratic identity scans',
    actual: { allowed, linear: identityReads <= members.length * 8 },
    expected: { allowed: true, linear: true },
  });
});
