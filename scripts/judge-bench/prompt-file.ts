/**
 * The judge bench's one editable prompt file: the fully assembled judging
 * prompt for a Round, split into calls and messages, with placeholders for
 * the Round's evidence and earlier calls' outputs. Unedited, it expands to
 * exactly the messages production sends.
 */
import type { ChatMessage } from '@daisy/ai-voice';

export type CallOptions = {
  readonly model?: string;
  readonly reasoning?: 'none' | 'low' | 'medium' | 'high';
  readonly maxTokens?: number;
  readonly temperature?: number;
  /**
   * ballot: the production ballot schema and check; case_map: the
   * production case-map schema and check; json: any JSON object; none: free text.
   */
  readonly schema?: 'ballot' | 'case_map' | 'json' | 'none';
};

export type PromptCall = {
  readonly number: number;
  readonly options: CallOptions;
  readonly messages: readonly ChatMessage[];
};

export type PromptFile = {
  readonly options: CallOptions;
  readonly calls: readonly PromptCall[];
};

export type Placeholders = {
  readonly evidence: string;
  readonly transcript: string;
  readonly resolution: string;
};

const HEADER = /^=== call (\d+): (system|user|assistant|options) ===$/;
const roles = new Set(['system', 'user', 'assistant']);

const help = `<!--
Judge bench prompt. Edit anything below, then: bun judge:bench run
  Sections:   === call N: system | user | assistant | options ===
  Calls run in order; a call's "options" section (key: value lines)
  overrides the frontmatter for that call only.
  Placeholders: {{evidence}} the exact production evidence JSON,
  {{transcript}} the same lines, readable; {{resolution}};
  {{callN}} the output of call N in this run.
  schema: ballot or case_map (production schema + check), json, or none.
  Anything in an HTML comment is dropped before sending.
-->`;

const parseOptions = (text: string): CallOptions => {
  const options: Record<string, string | number> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.replace(/#.*$/, '').trim();
    if (!trimmed) continue;
    const at = trimmed.indexOf(':');
    if (at < 0) throw new Error(`option line without "key: value": ${line}`);
    const key = trimmed.slice(0, at).trim();
    const value = trimmed.slice(at + 1).trim();
    if (
      !['model', 'reasoning', 'maxTokens', 'temperature', 'schema'].includes(
        key,
      )
    )
      throw new Error(`unknown option "${key}"`);
    options[key] =
      key === 'maxTokens' || key === 'temperature' ? Number(value) : value;
  }
  return options as CallOptions;
};

/** A comment on lines of its own goes with its line break; one inside a line leaves the line. */
const stripComments = (text: string) =>
  text
    .replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*\n/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');

/** The file's text as calls; message bodies keep their exact text. */
export function parsePromptFile(source: string): PromptFile {
  const text = stripComments(source);
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const options = front ? parseOptions(front[1]!) : {};
  const body = front ? text.slice(front[0].length) : text;
  const calls = new Map<
    number,
    { options: CallOptions; messages: ChatMessage[] }
  >();
  let current: { call: number; kind: string; lines: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const call = calls.get(current.call) ?? { options: {}, messages: [] };
    calls.set(current.call, call);
    // The blank line before the next header is layout, not content.
    const content = current.lines.join('\n').replace(/\n$/, '');
    if (current.kind === 'options') call.options = parseOptions(content);
    else
      call.messages.push({
        role: current.kind as ChatMessage['role'],
        content,
      });
  };
  for (const line of body.split('\n')) {
    const header = HEADER.exec(line);
    if (header) {
      flush();
      current = { call: Number(header[1]), kind: header[2]!, lines: [] };
    } else if (current) current.lines.push(line);
    else if (line.trim())
      throw new Error(`text before the first section: ${line}`);
  }
  flush();
  if (calls.size === 0) throw new Error('no "=== call 1: system ===" sections');
  return {
    options,
    calls: [...calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([number, call]) => {
        if (!call.messages.some((message) => roles.has(message.role)))
          throw new Error(`call ${number} has no messages`);
        return { number, options: call.options, messages: call.messages };
      }),
  };
}

/** Replaces placeholders; an unknown or not-yet-run {{callN}} is an error. */
export function expand(
  content: string,
  placeholders: Placeholders,
  outputs: ReadonlyMap<number, string>,
): string {
  return content.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => {
    const call = /^call(\d+)$/.exec(name);
    if (call) {
      const output = outputs.get(Number(call[1]));
      if (output === undefined)
        throw new Error(`${whole} is used before call ${call[1]} has run`);
      return output;
    }
    if (name in placeholders) return placeholders[name as keyof Placeholders];
    throw new Error(`unknown placeholder ${whole}`);
  });
}

const optionLines = (options: CallOptions) =>
  Object.entries(options)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');

/**
 * Production's calls as a prompt file: every exact text the placeholders
 * stand for (the evidence JSON, the numbered transcript, an earlier call's
 * output) is swapped back for its placeholder.
 */
export function renderPromptFile(input: {
  readonly calls: readonly {
    readonly messages: readonly ChatMessage[];
    readonly options?: CallOptions;
  }[];
  readonly swaps: readonly (readonly [text: string, placeholder: string])[];
  readonly options: CallOptions;
}): string {
  const swap = (content: string) =>
    input.swaps.reduce(
      (text, [exact, placeholder]) => text.split(exact).join(placeholder),
      content,
    );
  const sections = input.calls.flatMap((call, index) => [
    ...(call.options
      ? [`=== call ${index + 1}: options ===\n${optionLines(call.options)}\n`]
      : []),
    ...call.messages.map(
      (message) =>
        `=== call ${index + 1}: ${message.role} ===\n${swap(message.content)}\n`,
    ),
  ]);
  return `---\n${optionLines(input.options)}\n---\n${help}\n${sections.join('\n')}`;
}
