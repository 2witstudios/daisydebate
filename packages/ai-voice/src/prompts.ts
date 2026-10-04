import {
  aiDebateTurns,
  type AiDebateSide,
  type AiDebateTurn,
} from '@daisy/debate-engine';
import type { ChatMessage } from './openrouter';
import { wordBudget } from './speech';

/** One spoken line of the debate, in order. */
export type TranscriptEntry = {
  readonly turnIndex: number;
  readonly role: 'person' | 'ai';
  readonly text: string;
};

const sideOf = (
  role: TranscriptEntry['role'],
  aiSide: AiDebateSide,
): AiDebateSide =>
  role === 'ai'
    ? aiSide
    : aiSide === 'affirmative'
      ? 'negative'
      : 'affirmative';

/** The transcript from the AI's point of view: "you" is the AI. */
export function renderTranscript(
  transcript: readonly TranscriptEntry[],
  aiSide: AiDebateSide,
  you = 'you',
  them = 'opponent',
): string {
  return transcript
    .map((entry) => {
      const name = aiDebateTurns[entry.turnIndex]?.name ?? '?';
      const who = entry.role === 'ai' ? you : them;
      return `[${name} — ${sideOf(entry.role, aiSide)} (${who})] ${entry.text}`;
    })
    .join('\n');
}

/** How every AI debater argues, whatever its character. */
const DEBATING_RULES = [
  'The round is judged by a lay judge: be persuasive, clear and accessible, never jargon-heavy, never spread.',
  'Write for the ear. No markdown, bullet points, headings, emojis or stage directions; only the words you say.',
  'Signpost clearly ("My first contention...", "Turning to my opponent\'s second point...").',
  'Clash directly with what your opponent actually said, quoting or paraphrasing them.',
  'Use reasoning, examples and widely known facts. Never invent specific studies, statistics, quotes or citations.',
  'Speak numbers and abbreviations the way a person says them aloud.',
].join(' ');

/** The default persona for the AI debater (versioned and tunable later). */
const DEFAULT_PERSONA = [
  'You are a sharp, fair collegiate debater speaking aloud in a live one-on-one round.',
  DEBATING_RULES,
  'Be confident and a little witty, but respectful.',
].join(' ');

/**
 * A bot opponent's persona: its character colours how it talks, while the
 * debating rules keep it a fair, spoken debater that tries to win.
 */
export function debaterPersona({
  name,
  tagline,
  personality,
}: {
  readonly name: string;
  readonly tagline: string;
  readonly personality: string;
}): string {
  return [
    `You are ${name}, ${tagline.charAt(0).toLowerCase()}${tagline.slice(1)}. ${personality}`,
    'You are debating a person aloud in a live one-on-one round. Stay in character in how you talk, but argue as well as you can.',
    DEBATING_RULES,
    'Stay respectful to your opponent.',
  ].join(' ');
}

const SPEECH_GOALS: Record<string, string> = {
  AC: 'Open the round: briefly define key terms, then present two or three clear contentions that prove the resolution, each with a claim, reasoning and an example or impact.',
  NC: 'Give a brief roadmap, present one or two negative contentions, then directly answer the affirmative case point by point.',
  '1AR':
    'Answer the negative case and their attacks on your case, rebuild your contentions, and extend your strongest arguments. Be efficient.',
  NR: 'Crystallize the round: extend your best arguments, point out what the affirmative dropped, and give the judge two or three clear voting issues for the negative.',
  '2AR':
    'Final speech: no new arguments. Answer the negative rebuttal, then give the judge two or three clear voting issues for the affirmative.',
};

export function speechMessages({
  resolution,
  aiSide,
  turn,
  transcript,
  persona = DEFAULT_PERSONA,
}: {
  readonly resolution: string;
  readonly aiSide: AiDebateSide;
  readonly turn: AiDebateTurn;
  readonly transcript: readonly TranscriptEntry[];
  readonly persona?: string | undefined;
}): ChatMessage[] {
  const words = wordBudget(turn.durationMs);
  const history = transcript.length
    ? `The round so far:\n${renderTranscript(transcript, aiSide)}`
    : 'Nothing has been said yet.';
  return [
    { role: 'system', content: persona },
    {
      role: 'user',
      content: [
        `Resolution: "${resolution}". You are on the ${aiSide}.`,
        history,
        `Now deliver the ${turn.label} (${turn.name}). ${SPEECH_GOALS[turn.name] ?? ''}`,
        `It must fit ${turn.durationMs / 60_000} minutes spoken: about ${words} words, no more.`,
        'Reply with only the speech.',
      ].join('\n\n'),
    },
  ];
}

export function cxMessages({
  resolution,
  aiSide,
  turn,
  aiRole,
  transcript,
  persona = DEFAULT_PERSONA,
}: {
  readonly resolution: string;
  readonly aiSide: AiDebateSide;
  readonly turn: AiDebateTurn;
  readonly aiRole: 'asker' | 'answerer';
  readonly transcript: readonly TranscriptEntry[];
  readonly persona?: string | undefined;
}): ChatMessage[] {
  const exchange = transcript.filter((entry) => entry.turnIndex === turn.index);
  const earlier = transcript.filter((entry) => entry.turnIndex < turn.index);
  const task =
    aiRole === 'asker'
      ? exchange.length === 0
        ? 'Cross-examination begins and you are asking. Ask exactly one question: short (under 25 words), pointed, and aimed at a weakness you can use in your next speech.'
        : 'You are asking. If their last answer dodged, say so in a few words. Ask exactly one question: short (under 25 words), building toward a concession.'
      : 'You are answering in cross-examination. Answer their last question directly in one to three short sentences (under 50 words). Defend your position, do not concede anything vital, and do not give a speech.';
  return [
    { role: 'system', content: persona },
    {
      role: 'user',
      content: [
        `Resolution: "${resolution}". You are on the ${aiSide}.`,
        earlier.length
          ? `Speeches so far:\n${renderTranscript(earlier, aiSide)}`
          : '',
        exchange.length
          ? `This cross-examination so far:\n${renderTranscript(exchange, aiSide)}`
          : '',
        task,
        'Reply with only what you say aloud.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];
}

/** The default judging instructions (versioned and tunable later). */
const DEFAULT_RUBRIC = [
  'You are an experienced, fair debate judge who judges like a thoughtful lay person.',
  'Decide who did the better job of persuading you the resolution is true or false, based only on what was said.',
  'Weigh clash, the quality of reasoning and examples, arguments that were dropped or extended, and cross-examination.',
  'Do not reward invented evidence. Ignore transcription glitches. Do not intervene with your own arguments.',
].join(' ');

export function judgeMessages({
  resolution,
  personSide,
  transcript,
  rubric = DEFAULT_RUBRIC,
}: {
  readonly resolution: string;
  readonly personSide: AiDebateSide;
  readonly transcript: readonly TranscriptEntry[];
  readonly rubric?: string;
}): ChatMessage[] {
  const aiSide: AiDebateSide =
    personSide === 'affirmative' ? 'negative' : 'affirmative';
  return [
    { role: 'system', content: rubric },
    {
      role: 'user',
      content: [
        `Resolution: "${resolution}". The human debater was ${personSide}; the AI was ${aiSide}.`,
        `Transcript:\n${renderTranscript(transcript, aiSide, 'AI', 'human')}`,
        'Return only a JSON object of this shape:',
        '{"winner": "affirmative" | "negative", "reason": "two or three sentences explaining the decision", "speeches": [{"turn": "AC", "side": "affirmative", "strengths": "...", "improvements": "..."}], "tips": ["three concrete tips for the human debater"]}',
        'Include one speeches entry for each speech (not cross-examination) that was given.',
      ].join('\n\n'),
    },
  ];
}
