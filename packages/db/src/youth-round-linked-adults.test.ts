import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { youthRoundLinkedAdults } from './youth-live-reads';

setupRitewayBun();

const people = {
  debaters: [
    { actorId: 'd1', userId: 'u1', linkedAdultActorIds: ['coach'] },
    { actorId: 'd2', userId: 'u2', linkedAdultActorIds: ['coach', 'parent'] },
  ],
};

const harness = (division: Record<string, boolean | null>) => {
  const youthReads: string[] = [];
  const peopleReads: string[] = [];
  const linked = youthRoundLinkedAdults({
    readRoundYouth: async (roundId) => {
      youthReads.push(roundId);
      return division[roundId] ?? null;
    },
    people: async (roundId) => {
      peopleReads.push(roundId);
      return people;
    },
  });
  return { linked, youthReads, peopleReads };
};

describe('youthRoundLinkedAdults.peek', () => {
  test('what is known without a read', async () => {
    let cached: typeof people | undefined;
    const linked = youthRoundLinkedAdults({
      readRoundYouth: async (roundId) => roundId === 'youth',
      people: Object.assign(
        async () => {
          cached = people;
          return people;
        },
        { peek: () => cached },
      ),
    });
    const before = [linked.peek('youth'), linked.peek('open')];
    await linked('youth');
    await linked('open');
    assert({
      given:
        'Rounds never read, then a Youth Round and an Open Round each read once',
      should:
        'know nothing before, then the Youth fact from the cache and null for the Open Round',
      actual: [...before, linked.peek('youth'), linked.peek('open')],
      expected: [
        undefined,
        undefined,
        { linkedAdultActorIds: ['coach', 'parent'] },
        null,
      ],
    });
  });
});

describe('youthRoundLinkedAdults', () => {
  test('a Youth Round', async () => {
    const { linked, peopleReads } = harness({ youth: true });
    assert({
      given: 'a Youth Round whose two debaters share a coach',
      should: 'answer every linked adult once',
      actual: await linked('youth'),
      expected: { linkedAdultActorIds: ['coach', 'parent'] },
    });
    assert({
      given: 'the read above',
      should: "read the Round's people through the injected cache",
      actual: peopleReads,
      expected: ['youth'],
    });
  });

  test('any other Round', async () => {
    const { linked, peopleReads } = harness({ open: false });
    assert({
      given: 'a Round that is not a Youth one, and a missing Round',
      should: "answer null and never read anyone's links",
      actual: [await linked('open'), await linked('missing'), peopleReads],
      expected: [null, null, []],
    });
  });

  test('several first reads at once share one', async () => {
    const { linked, youthReads } = harness({ youth: true });
    await Promise.all([linked('youth'), linked('youth'), linked('youth')]);
    assert({
      given: 'three reads of one cold Round at once',
      should: 'read its division once',
      actual: youthReads,
      expected: ['youth'],
    });
  });

  test('whether a Round is Youth is read once', async () => {
    const { linked, youthReads } = harness({ youth: true, open: false });
    await linked('youth');
    await linked('youth');
    await linked('open');
    await linked('open');
    await linked('missing');
    await linked('missing');
    assert({
      given: 'two reads each of a Youth, an Open and a missing Round',
      should:
        'read the division once for each found Round (frozen at Start) and every time for a missing one',
      actual: youthReads,
      expected: ['youth', 'open', 'missing', 'missing'],
    });
  });
});
