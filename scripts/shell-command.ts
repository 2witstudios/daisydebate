/**
 * A small, pure POSIX-shell reader for the agent guard. It is not a shell:
 * it recovers the simple commands a command line would run, so the guard can
 * judge each one. Quoting, command lists, pipelines, subshells, command
 * substitution, redirection targets, heredocs and prefix assignments are
 * understood; anything it cannot resolve statically (a substitution or a
 * variable in a word) is flagged `dynamic` so a rule can refuse to guess.
 */

export type ShellCommand = {
  readonly words: readonly string[];
  readonly assignments: Readonly<Record<string, string>>;
  readonly redirects: readonly string[];
  readonly dynamic: boolean;
};

type Token =
  | { readonly kind: 'word'; readonly value: string; readonly dynamic: boolean }
  | { readonly kind: 'separator' }
  | { readonly kind: 'redirect'; readonly target: string };

// Written wherever a word held a substitution, so no rule can match it.
const SUBSTITUTED = '\u0000';

const separators = new Set([';', '&', '|', '(', ')', '\n']);
const reservedWords = new Set([
  '!',
  '{',
  '}',
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'do',
  'done',
  'while',
  'until',
  'time',
]);
const assignmentPattern = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;

type State = {
  readonly text: string;
  readonly tokens: Token[];
  readonly nested: string[];
  readonly heredocs: { delimiter: string; strip: boolean }[];
  word: string;
  inWord: boolean;
  dynamic: boolean;
  quote: '"' | "'" | undefined;
  redirectNext: boolean;
  heredocNext: { strip: boolean } | undefined;
};

/** Returns the index of the last character it consumed, or undefined. */
type Handler = (state: State, index: number) => number | undefined;

function closingParen(text: string, open: number): number {
  let depth = 0;
  let quote: string | undefined;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\' && quote === '"') index += 1;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '\\') index += 1;
    else if (char === "'" || char === '"') quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')' && --depth === 0) return index;
  }
  return text.length;
}

function closingBacktick(text: string, open: number): number {
  for (let index = open + 1; index < text.length; index += 1) {
    if (text[index] === '\\') index += 1;
    else if (text[index] === '`') return index;
  }
  return text.length;
}

function flush(state: State): void {
  if (!state.inWord) return;
  if (state.heredocNext) {
    state.heredocs.push({ delimiter: state.word, ...state.heredocNext });
    state.heredocNext = undefined;
  } else if (state.redirectNext) {
    state.tokens.push({ kind: 'redirect', target: state.word });
    state.redirectNext = false;
  } else
    state.tokens.push({
      kind: 'word',
      value: state.word,
      dynamic: state.dynamic,
    });
  state.word = '';
  state.inWord = false;
  state.dynamic = false;
}

function append(state: State, text: string, dynamic = false): void {
  state.word += text;
  state.inWord = true;
  state.dynamic ||= dynamic;
}

function skipHeredocBodies(state: State, from: number): number {
  const { text } = state;
  let index = from;
  for (const { delimiter, strip } of state.heredocs) {
    let line: string | undefined;
    while (index < text.length && line !== delimiter) {
      const end = text.indexOf('\n', index);
      const raw = text.slice(index, end === -1 ? text.length : end);
      line = strip ? raw.replace(/^\t+/, '') : raw;
      index = end === -1 ? text.length : end + 1;
    }
  }
  state.heredocs.length = 0;
  return index;
}

const singleQuoted: Handler = (state, index) => {
  if (state.quote !== "'") return undefined;
  const char = state.text[index];
  if (char === "'") state.quote = undefined;
  else state.word += char;
  return index;
};

const escaped: Handler = (state, index) => {
  if (state.text[index] !== '\\') return undefined;
  const next = state.text[index + 1];
  if (next === '\n' || next === undefined) return index + 1;
  const keepsBackslash = state.quote === '"' && !'"\\$`'.includes(next);
  append(state, keepsBackslash ? `\\${next}` : next);
  return index + 1;
};

const substitution: Handler = (state, index) => {
  const { text } = state;
  if (text[index] === '`') {
    const end = closingBacktick(text, index);
    state.nested.push(text.slice(index + 1, end));
    append(state, SUBSTITUTED, true);
    return end;
  }
  if (text[index] !== '$' || text[index + 1] !== '(') return undefined;
  const end = closingParen(text, index + 1);
  // $(( … )) is arithmetic, not a command.
  if (text[index + 2] !== '(') state.nested.push(text.slice(index + 2, end));
  append(state, SUBSTITUTED, true);
  return end;
};

const expansion: Handler = (state, index) => {
  const next = state.text[index + 1] ?? '';
  if (state.text[index] === '$' && /[A-Za-z_{@*#?$!0-9]/.test(next))
    state.dynamic = true;
  return undefined;
};

const doubleQuoted: Handler = (state, index) => {
  if (state.quote !== '"') return undefined;
  const char = state.text[index];
  if (char === '"') state.quote = undefined;
  else state.word += char;
  return index;
};

const quoteOpen: Handler = (state, index) => {
  const char = state.text[index];
  if (char !== '"' && char !== "'") return undefined;
  state.quote = char;
  state.inWord = true;
  return index;
};

const comment: Handler = (state, index) => {
  if (state.text[index] !== '#' || state.inWord) return undefined;
  const end = state.text.indexOf('\n', index);
  return (end === -1 ? state.text.length : end) - 1;
};

const heredoc: Handler = (state, index) => {
  const { text } = state;
  if (text.slice(index, index + 2) !== '<<' || text[index + 2] === '<')
    return undefined;
  flush(state);
  const strip = text[index + 2] === '-';
  state.heredocNext = { strip };
  return index + (strip ? 2 : 1);
};

const redirection: Handler = (state, index) => {
  const { text } = state;
  const char = text[index];
  const ampersand = char === '&' && text[index + 1] === '>';
  if (char !== '>' && char !== '<' && !ampersand) return undefined;
  // A word made only of digits right before the operator is a file
  // descriptor (2>), not an argument.
  if (state.inWord && /^\d+$/.test(state.word)) {
    state.word = '';
    state.inWord = false;
  } else flush(state);
  let next = index + (ampersand ? 2 : 1);
  if (text[next] === '>' || text[next] === '|') next += 1;
  if (!ampersand && text[next] === '&') {
    // >&2 and <&- duplicate descriptors; there is no target file.
    if (/[\d-]/.test(text[next + 1] ?? '')) return next + 1;
    next += 1;
  }
  state.redirectNext = char !== '<';
  return next - 1;
};

const separator: Handler = (state, index) => {
  const char = state.text[index];
  if (!separators.has(char)) return undefined;
  flush(state);
  state.tokens.push({ kind: 'separator' });
  return char === '\n' && state.heredocs.length > 0
    ? skipHeredocBodies(state, index + 1) - 1
    : index;
};

const blank: Handler = (state, index) => {
  const char = state.text[index];
  if (char !== ' ' && char !== '\t') return undefined;
  flush(state);
  return index;
};

const handlers: readonly Handler[] = [
  singleQuoted,
  escaped,
  substitution,
  expansion,
  doubleQuoted,
  quoteOpen,
  comment,
  heredoc,
  redirection,
  separator,
  blank,
];

function scan(text: string): Pick<State, 'tokens' | 'nested'> {
  const state: State = {
    text,
    tokens: [],
    nested: [],
    heredocs: [],
    word: '',
    inWord: false,
    dynamic: false,
    quote: undefined,
    redirectNext: false,
    heredocNext: undefined,
  };
  for (let index = 0; index < text.length; index += 1) {
    let handled: number | undefined;
    for (const handler of handlers) {
      handled = handler(state, index);
      if (handled !== undefined) break;
    }
    if (handled === undefined) append(state, text[index]);
    else index = handled;
  }
  flush(state);
  return state;
}

function toCommand(tokens: readonly Token[]): ShellCommand | undefined {
  const words: string[] = [];
  const assignments: Record<string, string> = {};
  const redirects: string[] = [];
  let dynamic = false;
  for (const token of tokens) {
    if (token.kind === 'redirect') redirects.push(token.target);
    if (token.kind !== 'word') continue;
    const assignment =
      words.length === 0 ? assignmentPattern.exec(token.value) : null;
    if (assignment) assignments[assignment[1]] = assignment[2];
    else if (words.length > 0 || !reservedWords.has(token.value)) {
      words.push(token.value);
      dynamic ||= token.dynamic;
    }
  }
  const empty =
    words.length === 0 &&
    redirects.length === 0 &&
    Object.keys(assignments).length === 0;
  return empty ? undefined : { words, assignments, redirects, dynamic };
}

/** Every simple command the line would run, substitutions included. */
export function parseShell(text: string): readonly ShellCommand[] {
  const { tokens, nested } = scan(text);
  const commands: ShellCommand[] = [];
  let current: Token[] = [];
  for (const token of [...tokens, { kind: 'separator' } as const]) {
    if (token.kind !== 'separator') {
      current.push(token);
      continue;
    }
    const command = toCommand(current);
    if (command) commands.push(command);
    current = [];
  }
  return [...commands, ...nested.flatMap((body) => parseShell(body))];
}
