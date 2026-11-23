import type {
  Answer,
  CorpusScript,
  Fault,
  PublisherStep,
  Reply,
  SpeakerStep,
} from './bot-corpus.test-support';

/**
 * The corpus's scripted rounds. The named ones restate the scenarios of the
 * publisher's and speaker's unit tests as they stood at `bfb17fa8d`; the
 * generated ones are drawn from a fixed seed list, so the corpus never
 * changes unless the bot does.
 */
const say = (...texts: readonly string[]) =>
  texts.map((text, index) => ({ text, ms: [120, 260, 80, 400][index % 4]! }));
const fail = (fault: Fault, delayMs = 0): Reply => ({ fail: fault, delayMs });
const slow = (delayMs: number): Reply => ({ delayMs });
const ok: Reply = {};
const wake: SpeakerStep = { wake: true };
const advance = (ms: number) => ({ advance: ms });
const ended: SpeakerStep = { peer: 'end-of-turn' };
const spoke: SpeakerStep = { peer: 'speech-start' };
const bargeIn: SpeakerStep = { peer: 'barge-in' };
const two = say('One.', 'Two.');
const four = say('One.', 'Two.', 'Three.', 'Four.');

const publisher = (
  name: string,
  steps: readonly PublisherStep[],
  store: Extract<CorpusScript, { kind: 'publisher' }>['store'] = {},
): CorpusScript => ({ kind: 'publisher', name, steps, store });
const opened = [{ start: true }, advance(10), { deadline: true }] as const;
const p = (id: string, ms: number, extra: object = {}) =>
  ({ publish: id, ms, ...extra }) as PublisherStep;

const publisherCases: readonly CorpusScript[] = [
  publisher('two phrases stream on one track and close whole', [
    ...opened,
    p('a', 50),
    p('b', 50),
    advance(450),
    { query: true },
  ]),
  publisher(
    'a floor read stalling beside the audio',
    [...opened, p('a', 1000)],
    { floor: [slow(200), slow(200)] },
  ),
  publisher(
    'a start refused because the room changed rejoins',
    [...opened, p('a', 100), p('b', 100)],
    { begin: [fail('room-changed')] },
  ),
  publisher(
    'a floor lost mid-phrase cuts the line',
    [...opened, p('a', 1000), { query: true }],
    { floor: [ok, fail('conflict')] },
  ),
  publisher('a barge-in cuts the line at the words played', [
    ...opened,
    p('a', 1000, { abortAfterMs: 400 }),
    { query: true },
  ]),
  publisher('a phrase that cannot finish before the stop never starts', [
    ...opened,
    p('a', 1000, { stopAtMs: 600 }),
    p('b', 100, { stopAtMs: 600 }),
  ]),
  publisher('a phrase that just fits plays whole', [
    ...opened,
    p('a', 500, { stopAtMs: 520 }),
  ]),
  publisher(
    'a deadline read on a slow verify',
    [{ start: true }, advance(10), { deadline: true }],
    { verify: [ok, slow(80)], dueMs: 5000 },
  ),
  publisher(
    'a close stalling never delays the next phrase',
    [...opened, p('a', 100), p('b', 100), p('c', 100), advance(500)],
    { end: [slow(200), slow(200)] },
  ),
  publisher('a tail cleared after its handoff closes cut', [
    ...opened,
    p('a', 500),
    { silence: true },
    advance(500),
    { query: true },
  ]),
  publisher(
    'a start that fails once is asked again',
    [...opened, p('a', 100), advance(400)],
    { begin: [fail('lost')] },
  ),
  publisher(
    'a refused start plays nothing',
    [...opened, p('a', 100), p('b', 100)],
    { begin: [fail('conflict')] },
  ),
  publisher(
    'a phrase asked ahead during the first join',
    [
      { start: true },
      { writeAhead: 'b', ms: 100 },
      p('a', 100),
      p('b', 100),
      advance(400),
    ],
    { join: [slow(50)] },
  ),
  publisher(
    'a slow start is authorized ahead',
    [
      ...opened,
      p('a', 600),
      { writeAhead: 'b', ms: 200 },
      p('b', 200),
      advance(500),
    ],
    { begin: [ok, slow(300)] },
  ),
  publisher('a phrase authorized ahead but never said', [
    ...opened,
    p('a', 300),
    { writeAhead: 'b', ms: 100 },
    { discard: true },
    advance(500),
    { query: true },
  ]),
  publisher(
    'an end whose answer is lost',
    [
      ...opened,
      p('a', 100),
      advance(500),
      { query: true },
      p('b', 100),
      advance(500),
    ],
    { end: [fail('lost'), fail('lost'), fail('lost')] },
  ),
  publisher(
    'an end that keeps failing is asked again at the next phrase',
    [
      ...opened,
      p('a', 100),
      advance(500),
      p('b', 100),
      advance(500),
      p('c', 100),
      advance(500),
    ],
    { end: [fail('lost'), fail('lost'), fail('lost'), ok, ok] },
  ),
  publisher(
    'an end refused for good is not asked again',
    [...opened, p('a', 100), advance(500), p('b', 100), advance(500)],
    { end: [fail('conflict')] },
  ),
  publisher('the first clear inside a tail cuts it', [
    ...opened,
    p('a', 300),
    { silence: true },
    advance(50),
    { silence: true },
    advance(500),
  ]),
  publisher('a hard stop cut is measured from what was handed', [
    ...opened,
    p('a', 1000, { stopAtMs: 500 }),
    advance(500),
  ]),
  publisher(
    'a floor read failing for a passing reason does not cut',
    [...opened, p('a', 800)],
    { floor: [fail('lost'), fail('lost')] },
  ),
  publisher(
    'after a refused start nothing after it is authorized ahead',
    [
      ...opened,
      p('a', 300),
      { writeAhead: 'b', ms: 100 },
      p('b', 100),
      { writeAhead: 'c', ms: 100 },
      p('c', 100),
    ],
    { begin: [ok, fail('conflict')] },
  ),
  publisher(
    'a stop before a phrase’s audio silences the tail before it',
    [...opened, p('a', 400), p('b', 200, { abortAfterMs: 0 }), advance(500)],
    { begin: [ok, slow(50)] },
  ),
  publisher(
    'the claim ends while a start backs off',
    [
      ...opened,
      p('a', 100, { detach: true }),
      advance(20),
      { close: true },
      advance(400),
    ],
    { begin: [fail('lost'), fail('lost')] },
  ),
  publisher(
    'a cut line whose end keeps failing is asked again at its credit',
    [
      ...opened,
      p('a', 1000, { abortAfterMs: 400 }),
      advance(500),
      p('b', 100),
      advance(500),
    ],
    { end: [fail('lost'), fail('lost'), fail('lost')] },
  ),
  publisher(
    'a start backing off writes nothing once the claim ends',
    [...opened, p('a', 100, { abortAfterMs: 50 }), { close: true }],
    { begin: [fail('lost'), fail('lost')] },
  ),
  publisher(
    'a reveal refused as the audio starts stops the phrase',
    [...opened, p('a', 500), { query: true }],
    { reveal: [fail('conflict')] },
  ),
  publisher('a phrase shorter than the lead', [
    ...opened,
    p('a', 100),
    p('b', 100),
    advance(500),
  ]),
  publisher(
    'a handoff failing before its audio starts writes no line',
    [...opened, p('a', 200), advance(500)],
    { failFrames: [3] },
  ),
  publisher(
    'a handoff failing mid-phrase',
    [...opened, p('a', 800), advance(500)],
    { failFrames: [50] },
  ),
  publisher(
    'a reveal retrying lands before the next',
    [...opened, p('a', 100), p('b', 100), advance(500)],
    { reveal: [fail('lost', 30), slow(10)] },
  ),
  publisher('a short phrase barged in on before its audio', [
    ...opened,
    p('a', 400),
    p('b', 50, { abortAfterMs: 100 }),
    advance(500),
  ]),
  publisher(
    'a short phrase whose reveal fails after its handoff',
    [...opened, p('a', 50), advance(500)],
    { reveal: [fail('conflict', 400)] },
  ),
  publisher(
    'a stop while the next phrase is authorized',
    [...opened, p('a', 300), p('b', 100, { abortAfterMs: 20 }), advance(500)],
    { begin: [ok, slow(100)] },
  ),
  publisher(
    'an authorization asked ahead that failed is asked again',
    [
      ...opened,
      p('a', 400),
      { writeAhead: 'b', ms: 100 },
      p('b', 100),
      advance(500),
    ],
    { begin: [ok, fail('lost'), fail('lost'), fail('lost')] },
  ),
  publisher(
    'a stop while a short phrase waits on a slow reveal',
    [...opened, p('a', 50, { abortAfterMs: 380 }), advance(500)],
    { reveal: [slow(500)] },
  ),
  publisher(
    'the claim’s end waits for an end retry in flight',
    [...opened, p('a', 100), advance(400), p('b', 100), { close: true }],
    { end: [fail('lost'), fail('lost'), fail('lost'), slow(100)] },
  ),
  publisher('a clear at the exact handoff instant', [
    ...opened,
    p('a', 30),
    { silence: true },
    advance(500),
  ]),
  publisher('the next phrase’s stop cuts the tail before', [
    ...opened,
    p('a', 400),
    p('b', 400, { abortAfterMs: 30 }),
    advance(500),
    { query: true },
  ]),
  publisher('a publish after close is refused', [
    ...opened,
    p('a', 100),
    { close: true },
    p('b', 100),
  ]),
  publisher('a publish already aborted', [
    ...opened,
    p('a', 100, { abortAfterMs: 0 }),
  ]),
  publisher(
    'a join that fails is joined again',
    [
      { start: true },
      advance(10),
      { deadline: true },
      p('a', 100),
      advance(500),
    ],
    { join: [fail('lost')] },
  ),
  publisher('a phrase not in whole frames is padded', [
    ...opened,
    p('a', 105),
    advance(500),
  ]),
  publisher('a publish asked already stopped', [
    ...opened,
    p('a', 100, { preAborted: true }),
  ]),
  publisher(
    'a stop while the track is still joining',
    [
      { start: true },
      p('a', 100, { abortAfterMs: 50, stopAtMs: 60_000 }),
      advance(500),
    ],
    { join: [slow(100)] },
  ),
  publisher(
    'a claim closed while its track is joining',
    [{ start: true }, advance(50), { close: true }],
    { join: [slow(200)] },
  ),
  publisher(
    'an early join that fails at its first use is joined again',
    [{ start: true }, p('a', 100, { stopAtMs: 60_000 }), advance(500)],
    { join: [fail('lost', 100)] },
  ),
];

const speaker = (
  name: string,
  segment: 'speech' | 'cross_ex',
  steps: readonly SpeakerStep[],
  rest: Partial<Extract<CorpusScript, { kind: 'speaker' }>> = {},
): CorpusScript => ({ kind: 'speaker', name, segment, steps, ...rest });
const speakerCases: readonly CorpusScript[] = [
  speaker(
    'a speech delivers its phrases once',
    'speech',
    [wake, advance(2000), wake, advance(2000)],
    { answers: [{ phrases: four }] },
  ),
  speaker(
    'refused authority waits without spending attempts',
    'speech',
    [wake, advance(500), wake, advance(3000), wake, advance(3000)],
    {
      answers: [{ phrases: two }],
      store: { begin: [fail('conflict'), fail('conflict')] },
    },
  ),
  speaker(
    'provider failures stop after the bounded attempts',
    'speech',
    [wake, advance(3000), wake, advance(3000), wake, advance(3000)],
    { answers: [{ phrases: two, fail: 'lost' }] },
  ),
  speaker(
    'a respondent stays silent until a question ends',
    'cross_ex',
    [wake, advance(500), spoke, advance(300), ended, wake, advance(3000)],
    { opensExchange: false, answers: [{ phrases: two }] },
  ),
  speaker(
    'cross-ex answers each turn once and barge-in cancels',
    'cross_ex',
    [
      wake,
      advance(100),
      bargeIn,
      advance(1000),
      ended,
      wake,
      advance(3000),
      ended,
      wake,
      advance(3000),
    ],
    { answers: [{ phrases: four }] },
  ),
  speaker(
    'a peer speaking over a queued tail silences it',
    'cross_ex',
    [wake, advance(390), spoke, advance(1000), ended, wake, advance(3000)],
    { answers: [{ phrases: say('One.') }] },
  ),
  speaker(
    'the speech ending stops voicing ahead',
    'speech',
    [wake, advance(700)],
    {
      answers: [
        { phrases: say('One.', 'Two.', 'Three.', 'Four.', 'Five.', 'Six.') },
      ],
      store: { dueMs: 800 },
    },
  ),
  speaker(
    'a paid answer is kept through settlement failures',
    'speech',
    [wake, advance(500), wake, advance(3000), wake, advance(3000)],
    { answers: [{ phrases: two, settle: [fail('lost'), fail('capacity')] }] },
  ),
  speaker(
    'a final refusal ends the speech',
    'speech',
    [wake, advance(500), wake, advance(3000)],
    { answers: [{ phrases: two }], store: { begin: [fail('final')] } },
  ),
  speaker(
    'a kept cross-ex answer is dropped on a new peer turn',
    'cross_ex',
    [wake, advance(10), ended, wake, advance(400), ended, wake, advance(3000)],
    {
      answers: [{ phrases: two }],
      store: { begin: [fail('lost'), fail('lost'), fail('lost')] },
    },
  ),
  speaker(
    'an empty answer is dropped',
    'speech',
    [wake, advance(300), wake, advance(3000), wake, advance(3000)],
    { answers: [{ phrases: [] }, { phrases: two }] },
  ),
  speaker(
    'hearing loss and a peer during preparation cancel nothing',
    'cross_ex',
    [wake, spoke, advance(10), ended, wake, advance(3000)],
    { answers: [{ phrases: two, delayMs: 200 }] },
  ),
  speaker(
    'never start over a peer mid-turn',
    'cross_ex',
    [ended, wake, advance(5), spoke, advance(500), ended, wake, advance(3000)],
    { opensExchange: false, answers: [{ phrases: two }] },
  ),
  speaker(
    'errors in one turn never mute a later one',
    'cross_ex',
    [wake, advance(3000), wake, advance(3000), ended, wake, advance(3000)],
    {
      answers: [
        { phrases: two, fail: 'lost' },
        { phrases: two, fail: 'lost' },
        { phrases: two },
      ],
    },
  ),
  speaker(
    'the asking seat presses an unanswered question once',
    'cross_ex',
    [wake, advance(2000), advance(9000), advance(9000), wake, advance(3000)],
    {
      answers: [
        { phrases: say('Question?') },
        { phrases: say('Again?', 'Really.') },
      ],
    },
  ),
  speaker(
    'a respondent is never pressed',
    'cross_ex',
    [wake, advance(20_000)],
    { opensExchange: false, answers: [{ phrases: two }] },
  ),
  speaker(
    'a full provider budget keeps a cross-ex answer',
    'cross_ex',
    [wake, advance(500), wake, advance(3000), wake, advance(3000)],
    { answers: [{ phrases: two }], voices: { 'One.': [fail('busy')] } },
  ),
  speaker(
    'no later phrase starts over a peer who began in the gap',
    'cross_ex',
    [wake, advance(115), spoke, advance(500), ended, wake, advance(3000)],
    { answers: [{ phrases: four }] },
  ),
  speaker(
    'a claim that stops abandons the answer',
    'cross_ex',
    [wake, advance(50), { stop: true }],
    { answers: [{ phrases: four, gapMs: 400 }] },
  ),
  speaker(
    'a peer going on before the answer is bought costs nothing',
    'cross_ex',
    [
      ended,
      wake,
      spoke,
      ended,
      wake,
      spoke,
      advance(3000),
      ended,
      wake,
      advance(3000),
    ],
    { opensExchange: false, answers: [{ phrases: two, delayMs: 50 }] },
  ),
  speaker(
    'capacity refusals defer without spending attempts',
    'speech',
    [
      wake,
      advance(10),
      wake,
      advance(3000),
      wake,
      advance(3000),
      wake,
      advance(3000),
    ],
    {
      answers: [
        { phrases: two, fail: 'capacity' },
        { phrases: two, fail: 'capacity' },
        { phrases: two },
      ],
    },
  ),
  speaker(
    'a deferred turn resumes at its refused step',
    'speech',
    [
      wake,
      advance(500),
      wake,
      advance(3000),
      wake,
      advance(3000),
      wake,
      advance(3000),
    ],
    {
      answers: [{ phrases: four, settle: [fail('capacity')] }],
      voiceSettles: { 'Two.': [fail('capacity')] },
      voices: { 'Three.': [fail('capacity')] },
    },
  ),
  speaker(
    'a phrase whose start outcome is unknown keeps its line id',
    'speech',
    [wake, advance(500), wake, advance(3000)],
    {
      answers: [{ phrases: two }],
      store: { begin: [fail('lost'), fail('lost'), fail('lost')] },
    },
  ),
  speaker(
    'a phrase cut and closed is said again as a new line',
    'speech',
    [wake, advance(500), wake, advance(3000)],
    {
      answers: [{ phrases: say('One long.', 'Two.') }],
      store: { floor: [fail('conflict')] },
    },
  ),
  speaker(
    'a voice still settling is awaited once',
    'speech',
    [wake, advance(3000)],
    { answers: [{ phrases: four }], voiceSettles: { 'Two.': [slow(500)] } },
  ),
  speaker(
    'an incident stops the job and the same answer resumes',
    'speech',
    [wake, advance(150), wake, advance(3000), wake, advance(3000)],
    { answers: [{ phrases: four }], store: { begin: [ok, fail('incident')] } },
  ),
  speaker(
    'an incident cutting the tail before resumes there',
    'speech',
    [wake, advance(500), wake, advance(3000)],
    { answers: [{ phrases: four }], store: { reveal: [ok, fail('incident')] } },
  ),
  speaker(
    'a failed native handoff is a recorded failure',
    'speech',
    [wake, advance(500), wake, advance(3000)],
    { answers: [{ phrases: two }], store: { failFrames: [5] } },
  ),
  speaker(
    'the segment end stops at the last whole phrase',
    'speech',
    [wake, advance(2000)],
    { answers: [{ phrases: four }], store: { dueMs: 500 } },
  ),
  speaker(
    'a voice ahead failing is voiced again in turn',
    'speech',
    [wake, advance(3000)],
    {
      answers: [{ phrases: four }],
      voices: { 'Two.': [fail('lost')], 'Three.': [fail('capacity')] },
    },
  ),
  speaker(
    'a prefetched answer whose settlement failed',
    'speech',
    [wake, advance(3000), wake, advance(3000)],
    { answers: [{ phrases: four }], voiceSettles: { 'Two.': [fail('lost')] } },
  ),
  speaker(
    'a final phrase whose start fails for good',
    'speech',
    [wake, advance(500), wake, advance(3000)],
    { answers: [{ phrases: two }], store: { begin: [ok, fail('conflict')] } },
  ),
  speaker(
    'short openings wait for the next voices',
    'speech',
    [wake, advance(3000)],
    {
      answers: [{ phrases: say('A.', 'B.', 'C.', 'D.') }],
      voices: { 'B.': [slow(200)], 'C.': [slow(400)] },
    },
  ),
  speaker(
    'a streamed answer starts with its first phrase',
    'speech',
    [wake, advance(5000), wake, advance(1000)],
    { answers: [{ phrases: four, gapMs: 300 }] },
  ),
  speaker(
    'an answer cut short is spoken to its last phrase',
    'speech',
    [wake, advance(3000), wake, advance(3000)],
    { answers: [{ phrases: two, gapMs: 100, cut: true }] },
  ),
  speaker(
    'after a refusal the speaker wakes itself',
    'speech',
    [wake, advance(5000)],
    { answers: [{ phrases: two }], voices: { 'One.': [fail('capacity')] } },
  ),
  speaker(
    'an unanswered question pressed voices its later phrases ahead',
    'cross_ex',
    [wake, advance(1000), advance(9000), advance(3000)],
    { answers: [{ phrases: say('Q?') }, { phrases: four }] },
  ),
  speaker(
    'a pause from one turn never holds the next',
    'cross_ex',
    [wake, advance(100), ended, wake, advance(3000)],
    { answers: [{ phrases: two, fail: 'capacity' }, { phrases: two }] },
  ),
];

/** A small seeded generator, so generated cases never change. */
function drawsFrom(seed: number) {
  let state = seed >>> 0;
  return (limit: number) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) % limit;
  };
}
const FAULTS: readonly Fault[] = [
  'lost',
  'conflict',
  'room-changed',
  'incident',
];
const repliesOf = (draw: Draw, length: number) =>
  Array.from({ length }, (): Reply => {
    const kind = draw(6);
    if (kind === 0) return fail(FAULTS[draw(FAULTS.length)]!, draw(3) * 40);
    if (kind === 1) return slow(draw(8) * 50);
    return ok;
  });

/** A draw below `limit`, as `@daisy/seeded-random/testing` gives a walk. */
type Draw = (limit: number) => number;

/** A publisher round built from draws: phrases, stops, clears and stub answers. */
export function generatedPublisher(name: string, draw: Draw): CorpusScript {
  const steps: PublisherStep[] = [...opened];
  const count = 2 + draw(5);
  const stop = draw(3) === 0 ? 300 + draw(2000) : undefined;
  for (let index = 0; index < count; index++) {
    const id = `p${index}`;
    const ms = (1 + draw(60)) * 10;
    if (draw(3) === 0) steps.push({ writeAhead: id, ms });
    steps.push(
      p(id, ms, {
        ...(stop === undefined ? {} : { stopAtMs: stop }),
        ...(draw(4) === 0 ? { abortAfterMs: draw(500) } : {}),
      }),
    );
    if (draw(3) === 0) steps.push({ silence: true });
    if (draw(3) === 0) steps.push(advance(draw(400)));
    if (draw(5) === 0) steps.push({ discard: true });
  }
  steps.push({ query: true });
  if (draw(2) === 0) steps.push({ close: true }, p('late', 100));
  return publisher(name, steps, {
    begin: repliesOf(draw, 6),
    reveal: repliesOf(draw, 6),
    end: repliesOf(draw, 6),
    floor: repliesOf(draw, 10),
    ...(draw(4) === 0 ? { failFrames: [draw(200)] } : {}),
  });
}

/** A speaker round built from draws: answers, peers, wakes and stub answers. */
export function generatedSpeaker(name: string, draw: Draw): CorpusScript {
  const segment = draw(2) === 0 ? 'speech' : 'cross_ex';
  const texts = ['One.', 'Two.', 'Three.', 'Four.', 'Five.'].slice(
    0,
    1 + draw(5),
  );
  const answers: Answer[] = Array.from({ length: 3 }, () => ({
    phrases: say(...texts),
    ...(draw(4) === 0 ? { fail: FAULTS[draw(2)]! } : {}),
    ...(draw(3) === 0 ? { gapMs: draw(300) } : {}),
    ...(draw(4) === 0 ? { cut: true } : {}),
    settle: repliesOf(draw, 2),
  }));
  const steps: SpeakerStep[] = [];
  const moves: readonly (() => SpeakerStep)[] = [
    () => wake,
    () => advance(draw(1500)),
    () => ended,
    () => spoke,
    () => bargeIn,
  ];
  for (let index = 0; index < 6 + draw(10); index++) {
    const move = moves[draw(segment === 'speech' ? 2 : moves.length)]!();
    steps.push(move);
    // The seat's pulse follows what its hearing reports, as it does live.
    if ('peer' in move && draw(3) > 0) steps.push(wake);
  }
  steps.push(advance(5000), wake, advance(5000));
  return speaker(name, segment, steps, {
    opensExchange: draw(2) === 0,
    answers,
    voices: Object.fromEntries(texts.map((text) => [text, repliesOf(draw, 2)])),
    voiceSettles: Object.fromEntries(
      texts.map((text) => [text, repliesOf(draw, 1)]),
    ),
    store: {
      begin: repliesOf(draw, 4),
      reveal: repliesOf(draw, 4),
      end: repliesOf(draw, 3),
      floor: repliesOf(draw, 6),
      ...(draw(3) === 0 ? { dueMs: 500 + draw(4000) } : {}),
    },
  });
}

/** The corpus seeds: fixed, so the corpus is the same on every run. */
const SEEDS = Array.from({ length: 40 }, (_, index) => index + 1);

export const corpusScripts = (): readonly CorpusScript[] => [
  ...publisherCases,
  ...speakerCases,
  ...SEEDS.map((seed) =>
    generatedPublisher(`generated publisher ${seed}`, drawsFrom(seed)),
  ),
  ...SEEDS.map((seed) =>
    generatedSpeaker(`generated speaker ${seed}`, drawsFrom(seed * 7919)),
  ),
];
