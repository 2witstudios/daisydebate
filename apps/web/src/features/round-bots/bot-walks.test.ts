import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { seededAsyncDraws, type Draw } from '@daisy/seeded-random/testing';
import {
  generatedPublisher,
  generatedSpeaker,
} from './bot-corpus-cases.test-support';
import {
  traceCorpus,
  type CorpusScript,
  type Fact,
  type Fault,
  type Reply,
} from './bot-corpus.test-support';

setupRitewayBun();

/**
 * The bot's properties over generated walks (R4.3): each walk is a scripted
 * round built from draws, run on a virtual clock through the real speaker
 * and publisher, and read back as the calls it made across the bot's edge.
 * They know nothing of how the bot decides, so they hold across a rewrite.
 * Each property runs every seed in the fixed list; `bun bots:sabotage` shows
 * mutations only these walks catch.
 */
const SEEDS = [4317, 4318, 4319] as const;
const RUNS = 40;
/** Draws on one walk's tape: more than any generated round takes. */
const DRAWS = 400;

type Facts = readonly Fact[];
const of = <K extends Fact['kind']>(facts: Facts, kind: K) =>
  facts.filter(
    (fact): fact is Extract<Fact, { kind: K }> => fact.kind === kind,
  );

/** Every revealed line gets exactly one end; no end closes a line never revealed. */
function oneEndPerLine(facts: Facts): string[] {
  const revealed = new Set(of(facts, 'reveal').map((fact) => fact.phraseId));
  const problems: string[] = [];
  for (const id of revealed) {
    const ends = new Set(
      of(facts, 'end')
        .filter((end) => end.phraseId === id)
        .map((end) => (end.whole ? 'whole' : `cut ${end.playedMs}`)),
    );
    if (ends.size !== 1)
      problems.push(`line ${id} revealed with ${ends.size} distinct ends`);
  }
  for (const end of of(facts, 'end'))
    if (!revealed.has(end.phraseId))
      problems.push(`line ${end.phraseId} ended but never revealed`);
  return problems;
}

/** A line's end never credits more than the audio handed over for it. */
function creditWithinHandoff(facts: Facts): string[] {
  return of(facts, 'end').flatMap((end) => {
    const handedMs =
      of(facts, 'frame').filter((frame) => frame.phraseId === end.phraseId)
        .length * 10;
    const durationMs =
      of(facts, 'publish').find((asked) => asked.phraseId === end.phraseId)
        ?.durationMs ?? 0;
    const creditMs = end.whole ? durationMs : end.playedMs;
    return creditMs > handedMs
      ? [`line ${end.phraseId} credited ${creditMs}ms of ${handedMs}ms handed`]
      : [];
  });
}

/** No frame plays past the stop its phrase was published with. */
function noFramePastStop(facts: Facts): string[] {
  const stops = new Map<string, number>();
  const problems: string[] = [];
  for (const fact of facts) {
    if (fact.kind === 'publish') stops.set(fact.phraseId, fact.stopAtMs);
    if (fact.kind !== 'frame') continue;
    const stop = fact.phraseId === null ? undefined : stops.get(fact.phraseId);
    if (stop === undefined || fact.playsUntilMs > stop)
      problems.push(
        `a frame of ${fact.phraseId} plays until ${fact.playsUntilMs}, past ${stop}`,
      );
  }
  return problems;
}

/** Once the claim is ending, nothing new is joined, authorized, revealed or handed over. */
function nothingAfterClaimEnd(facts: Facts): string[] {
  const closed = facts.findIndex((fact) => fact.kind === 'close');
  if (closed < 0) return [];
  return facts
    .slice(closed)
    .filter((fact) => ['begin', 'reveal', 'frame'].includes(fact.kind))
    .map((fact) => `${fact.kind} at ${fact.at} after the claim ended`);
}

const publisherProperties = [
  oneEndPerLine,
  creditWithinHandoff,
  noFramePastStop,
  nothingAfterClaimEnd,
] as const;

/** Phrase order in a generated answer: the phrases are named for their place. */
const PLACES = ['One.', 'Two.', 'Three.', 'Four.', 'Five.'];

/** Each answer's windows: the facts from one bought answer to the next. */
function answers(facts: Facts) {
  const windows: { to: string; facts: Fact[] }[] = [];
  for (const fact of facts) {
    if (fact.kind === 'generate' && fact.ok)
      windows.push({ to: fact.to, facts: [] });
    windows.at(-1)?.facts.push(fact);
  }
  return windows;
}

/** A phrase is voiced at most once per answer, unless its voicing failed. */
function boughtOnce(facts: Facts): string[] {
  return answers(facts).flatMap(({ facts: window }) => {
    const bought = of(window, 'tts').filter((tts) => tts.ok);
    const texts = bought.map((tts) => tts.text);
    return texts
      .filter((text, index) => texts.indexOf(text) !== index)
      .map((text) => `"${text}" voiced twice for one answer`);
  });
}

/** Lines are said in order: never ahead of the next unsaid phrase. */
function saidInOrder(facts: Facts): string[] {
  const texts = new Map(
    of(facts, 'publish').map((asked) => [asked.phraseId, asked.text]),
  );
  return answers(facts).flatMap(({ facts: window }) => {
    let reached = -1;
    const problems: string[] = [];
    for (const reveal of of(window, 'reveal')) {
      const place = PLACES.indexOf(texts.get(reveal.phraseId) ?? '');
      if (place > reached + 1)
        problems.push(
          `"${PLACES[place]}" said before "${PLACES[reached + 1]}"`,
        );
      reached = Math.max(reached, place);
    }
    return problems;
  });
}

/** One answer per turn: no turn is answered to its end twice. */
function oneAnswerPerTurn(facts: Facts): string[] {
  const delivered = of(facts, 'delivered').map(({ to }) => to);
  return delivered
    .filter((to, index) => delivered.indexOf(to) !== index)
    .map((to) => `turn ${to} answered twice`);
}

/** In cross-examination nothing is published while a peer is mid-turn. */
function quietOverPeers(facts: Facts): string[] {
  const midTurn = new Set<string>();
  const problems: string[] = [];
  for (const fact of facts) {
    if (fact.kind === 'peer')
      if (fact.event === 'end-of-turn') midTurn.delete(fact.peer);
      else midTurn.add(fact.peer);
    if (fact.kind === 'publish' && midTurn.size > 0)
      problems.push(`published at ${fact.at} while ${[...midTurn]} spoke`);
  }
  return problems;
}

/** Once the claim stops, or its speech is refused for good, nothing more is bought or said. */
function silentAfterOver(facts: Facts): string[] {
  const over = facts.findIndex(
    (fact) => fact.kind === 'stop' || fact.kind === 'final',
  );
  if (over < 0) return [];
  return facts
    .slice(over + 1)
    .filter(
      (fact) =>
        fact.kind === 'generate' ||
        fact.kind === 'publish' ||
        (fact.kind === 'begin' && facts[over]?.kind === 'stop'),
    )
    .map((fact) => `${fact.kind} at ${fact.at} after the speech was over`);
}

const speakerProperties = [
  boughtOnce,
  saidInOrder,
  oneAnswerPerTurn,
  silentAfterOver,
  ...publisherProperties,
] as const;

/** Runs one generated round and returns what its properties found. */
const walk =
  (
    build: (draw: Draw) => CorpusScript,
    properties: readonly ((facts: Facts) => string[])[],
  ) =>
  async (draw: Draw) => {
    const { facts, sleepers } = await traceCorpus(build(draw));
    return [
      ...properties.flatMap((property) => property(facts)),
      ...(sleepers === 0 ? [] : [`${sleepers} waits outlived the claim`]),
    ];
  };

const holds = async (problems: (draw: Draw) => Promise<readonly string[]>) => {
  const failures: string[] = [];
  for (const seed of SEEDS) {
    const report = await seededAsyncDraws({
      seed,
      runs: RUNS,
      draws: DRAWS,
      problems,
    });
    if (report.failure !== null) failures.push(report.failure);
  }
  return failures;
};

/** Refusals that clear by themselves: the speaker waits them out on its own timer. */
const PASSING: readonly Fault[] = ['capacity', 'busy', 'incident', 'conflict'];
const passing = (draw: Draw, length: number): Reply[] =>
  Array.from({ length }, () =>
    draw(2) === 0 ? { fail: PASSING[draw(PASSING.length)]! } : {},
  );

/** A speech woken once, refused any number of times for a passing reason. */
function deferredSpeech(draw: Draw): CorpusScript {
  const phrases = PLACES.slice(0, 1 + draw(4)).map((text) => ({
    text,
    ms: (1 + draw(30)) * 10,
  }));
  return {
    kind: 'speaker',
    name: 'deferred speech',
    segment: 'speech',
    answers: [{ phrases, settle: passing(draw, 2) }],
    voices: Object.fromEntries(
      phrases.map(({ text }) => [text, passing(draw, 2)]),
    ),
    store: { begin: passing(draw, 3) },
    steps: [{ wake: true }, { advance: 60_000 }],
  };
}

describe('the bot’s generated walks (R4.3)', () => {
  test('publisher walks', async () => {
    assert({
      given: `generated publisher rounds over seeds ${SEEDS.join(', ')}`,
      should:
        'end each revealed line once, credit only handed audio, play nothing past the stop and begin nothing after the claim ends',
      actual: await holds(
        walk((draw) => generatedPublisher('walk', draw), publisherProperties),
      ),
      expected: [],
    });
  });

  test('speaker walks', async () => {
    assert({
      given: `generated speeches and cross-examinations over seeds ${SEEDS.join(', ')}`,
      should:
        'buy each phrase once unless it failed, say lines in order, answer each turn once, stay quiet over peers and be silent once over',
      actual: await holds(
        walk(
          (draw) => {
            const script = generatedSpeaker('walk', draw);
            return script;
          },
          [...speakerProperties, quietOverPeers],
        ),
      ),
      expected: [],
    });
  });

  test('timed waits wake the speaker by themselves', async () => {
    assert({
      given: `a speech woken once and refused for passing reasons, over seeds ${SEEDS.join(', ')}`,
      should:
        'wake itself after each refusal and say every phrase, in order, with no wait left once the claim ends',
      actual: await holds(async (draw) => {
        const script = deferredSpeech(draw);
        const { facts, sleepers } = await traceCorpus(script);
        const said = of(facts, 'publish')
          .filter((asked) =>
            of(facts, 'reveal').some(
              (line) => line.phraseId === asked.phraseId,
            ),
          )
          .map((asked) => asked.text);
        const phrases =
          script.kind === 'speaker'
            ? (script.answers?.[0]?.phrases.map(({ text }) => text) ?? [])
            : [];
        return [
          ...speakerProperties.flatMap((property) => property(facts)),
          ...([...new Set(said)].join() === phrases.join()
            ? []
            : [`said ${said.join(' ')} of ${phrases.join(' ')}`]),
          ...(sleepers === 0 ? [] : [`${sleepers} waits outlived the claim`]),
        ];
      }),
      expected: [],
    });
  });

  test('the asking seat presses a question once, by itself', async () => {
    const { facts } = await traceCorpus({
      kind: 'speaker',
      name: 'pressed',
      segment: 'cross_ex',
      answers: [
        { phrases: [{ text: 'Why?', ms: 200 }] },
        { phrases: [{ text: 'Well?', ms: 200 }] },
      ],
      steps: [{ wake: true }, { advance: 60_000 }],
    });
    assert({
      given: 'an asking seat whose question meets silence and no pulse',
      should: 'press it exactly once when the silence timer runs out',
      actual: of(facts, 'generate').map((fact) => `${fact.to}@${fact.at}`),
      expected: ['opening@0', 'unanswered@8000'],
    });
  });
});
