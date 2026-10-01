import { z } from 'zod';
/**
 * The argument drill: write (or speak) a claim, a warrant and an impact,
 * check the structure, revise and save. The check is a pure, rule-based
 * function over the text. It is sample logic that looks for the three parts
 * and for vague phrases; it does not judge whether the argument is right.
 */
export type DrillPart = 'claim' | 'warrant' | 'impact';
export const drillParts: readonly DrillPart[] = ['claim', 'warrant', 'impact'];

export type DrillText = Readonly<Record<DrillPart, string>>;

export const emptyText: DrillText = { claim: '', warrant: '', impact: '' };

export type PartStatus = 'clear' | 'needs-work' | 'missing';

export type PartCheck = {
  readonly part: DrillPart;
  readonly status: PartStatus;
  readonly message: string;
  /** The vague phrase to mark, as offsets into the part's text. */
  readonly highlight: { readonly start: number; readonly end: number } | null;
};

export type StructureCheck = {
  readonly parts: readonly PartCheck[];
  readonly clearCount: number;
  readonly allClear: boolean;
};

/** Sample thresholds: the check is a rule of thumb, not a judgement. */
export const MIN_CLAIM = 15;
export const MIN_WARRANT = 50;
export const MIN_IMPACT = 40;
/** Longest a part may be; the form's field and the server both cap at this. */
export const MAX_PART = 600;

const vague = /everything (else )?depends on|stuff|things like that/i;

type Rule = {
  readonly clearMessage: string;
  readonly otherwiseMessage: string;
  readonly missingMessage: string;
};

const rules: Readonly<Record<DrillPart, Rule>> = {
  claim: {
    clearMessage: 'Specific and arguable: it says what comes first.',
    otherwiseMessage:
      'State your claim in a full sentence the other side could disagree with.',
    missingMessage:
      'State your claim in a full sentence the other side could disagree with.',
  },
  warrant: {
    clearMessage: 'A reason the judge can follow.',
    otherwiseMessage:
      'This is vague. Name what depends on transit, and how. Who cannot get where, and what follows?',
    missingMessage:
      'Give the reason it is true: the mechanism, not a repeat of the claim.',
  },
  impact: {
    clearMessage: 'It says who is affected and what they lose.',
    otherwiseMessage: 'Say why it matters and to whom, in a sentence or two.',
    missingMessage:
      'Missing. Say why it matters and to whom. Try a stem: “This matters because ... for ...”.',
  },
};

const longEnough = (part: DrillPart, text: string): boolean => {
  const length = text.trim().length;
  if (part === 'claim') return length >= MIN_CLAIM;
  if (part === 'warrant') return length >= MIN_WARRANT && !vague.test(text);
  return length >= MIN_IMPACT;
};

function checkPart(part: DrillPart, text: string): PartCheck {
  const rule = rules[part];
  const missing = text.trim() === '';
  const clear = !missing && longEnough(part, text);
  const found = part === 'warrant' && !clear ? vague.exec(text) : null;
  return {
    part,
    status: clear ? 'clear' : missing ? 'missing' : 'needs-work',
    message: clear
      ? rule.clearMessage
      : missing
        ? rule.missingMessage
        : rule.otherwiseMessage,
    highlight: found
      ? { start: found.index, end: found.index + found[0].length }
      : null,
  };
}

/** Looks for a claim, a warrant and an impact, and for vague phrases. */
export function checkStructure(text: DrillText): StructureCheck {
  const parts = drillParts.map((part) => checkPart(part, text[part]));
  const clearCount = parts.filter((part) => part.status === 'clear').length;
  return { parts, clearCount, allClear: clearCount === parts.length };
}

export const IMPACT_STEM = 'This matters because ';

/** Starts an empty impact with the stem; never overwrites what was written. */
export const withImpactStem = (text: DrillText): DrillText =>
  text.impact.trim() === '' ? { ...text, impact: IMPACT_STEM } : text;

export const drillModes = ['write', 'speak'] as const;
export type DrillMode = (typeof drillModes)[number];

export const drillPhases = ['edit', 'checked', 'saved'] as const;
export type DrillPhase = (typeof drillPhases)[number];

export type DrillState = {
  readonly phase: DrillPhase;
  readonly mode: DrillMode;
  readonly text: DrillText;
  readonly check: StructureCheck | null;
  /** Set when the answer needs saying: nothing to check, or no connection. */
  readonly notice: 'nothing-to-check' | 'unavailable' | null;
};

export const initialDrill: DrillState = {
  phase: 'edit',
  mode: 'write',
  text: emptyText,
  check: null,
  notice: null,
};

const intents = [
  'check',
  'revise',
  'save',
  'stem',
  'mode-write',
  'mode-speak',
] as const;

/** What the drill form posts, read defensively: every field has a fallback. */
export type DrillInput = {
  readonly intent: (typeof intents)[number] | null;
  readonly mode: DrillMode;
  readonly text: DrillText;
};

const textField = z
  .string()
  .transform((value) => value.slice(0, MAX_PART))
  .catch('');

const field = (form: FormData, name: string): unknown => form.get(name);

/** Reads the posted form; anything missing or malformed becomes a default. */
export function parseDrillForm(form: FormData): DrillInput {
  return {
    intent: z.enum(intents).nullable().catch(null).parse(field(form, 'intent')),
    mode: z.enum(drillModes).catch('write').parse(field(form, 'mode')),
    text: {
      claim: textField.parse(field(form, 'claim')),
      warrant: textField.parse(field(form, 'warrant')),
      impact: textField.parse(field(form, 'impact')),
    },
  };
}

const hasText = (text: DrillText): boolean =>
  drillParts.some((part) => text[part].trim() !== '');

/**
 * The next state for a posted form. Nothing from the previous state is
 * trusted: the phase follows from the intent, and the check is recomputed
 * from the posted text, so a forged form cannot reach Saved without all
 * three parts being clear.
 */
export function stepDrill(input: DrillInput): DrillState {
  const { text, mode } = input;
  const edit: DrillState = { ...initialDrill, mode, text };
  if (input.intent === 'mode-write') return { ...edit, mode: 'write' };
  if (input.intent === 'mode-speak') return { ...edit, mode: 'speak' };
  if (input.intent === 'stem') return { ...edit, text: withImpactStem(text) };
  if (input.intent !== 'check' && input.intent !== 'save') return edit;
  if (!hasText(text)) return { ...edit, notice: 'nothing-to-check' };
  const check = checkStructure(text);
  const saved = input.intent === 'save' && check.allClear;
  return { ...edit, phase: saved ? 'saved' : 'checked', check };
}

/** The state when the form could not reach the server: the text is kept. */
export const drillUnavailable = (form: FormData): DrillState => {
  const { mode, text } = parseDrillForm(form);
  return { ...initialDrill, mode, text, notice: 'unavailable' };
};
