import { dirname, join, normalize } from 'node:path';
import { isRoundMediaHref } from '../../features/round-media/browser-policy';

/** An app source file, `file` relative to `src`. */
export type Source = { readonly file: string; readonly text: string };

/** Index just past the string or template literal opening at `start`. */
function skipLiteral(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length && text[i] !== quote) {
    if (text[i] === '\\') i += 2;
    else if (quote === '`' && text.startsWith('${', i))
      i = skipBalanced(text, i + 1);
    else i += 1;
  }
  return i + 1;
}

/** Index just past the bracket group opening at `start`. */
function skipBalanced(text: string, start: number): number {
  const close = { '{': '}', '(': ')' }[text[start] as '{' | '('];
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const char = text[i]!;
    if (char === "'" || char === '"' || char === '`') {
      i = skipLiteral(text, i);
      continue;
    }
    if (char === text[start]) depth += 1;
    if (char === close && --depth === 0) return i + 1;
    i += 1;
  }
  return i;
}

/** A conditional between two literals, `c ? '/room' : ''`, yields both. */
const conditional = /\?\s*(['"])([^'"]*)\1\s*:\s*(['"])([^'"]*)\3\s*$/;

/** Every path a string or template literal can produce; `${…}` is one segment. */
function literalPaths(literal: string): readonly string[] {
  if (literal[0] !== '`') return [literal.slice(1, -1)];
  let paths = [''];
  let i = 1;
  while (i < literal.length - 1) {
    if (literal.startsWith('${', i)) {
      const end = skipBalanced(literal, i + 1);
      const match = literal.slice(i + 2, end - 1).match(conditional);
      const options = match ? [match[2]!, match[4]!] : ['x'];
      paths = paths.flatMap((path) => options.map((option) => path + option));
      i = end;
    } else {
      const char = literal[i]!;
      paths = paths.map((path) => path + char);
      i += 1;
    }
  }
  return paths;
}

/** Only an app-relative path can be a media page; anything else is skipped. */
const isAppMediaPath = (path: string) =>
  /^\/(?!\/)/.test(path) && isRoundMediaHref(path);
const isLiteral = (expression: string) => /^['"`]/.test(expression);
const isMediaLiteral = (literal: string) =>
  literal.endsWith(literal[0]!) && literalPaths(literal).some(isAppMediaPath);
const literalAt = (text: string, start: number) =>
  text.slice(start, skipLiteral(text, start));

/**
 * Names whose definition is a media href literal: object properties
 * (`followHref: \`/rounds/…\``, matched by name anywhere) and bindings
 * (`const roomHref = (id) => \`/rooms/…\``, matched in their file or through
 * an import). A property named `href` is too generic to follow.
 */
function mediaBuilders(sources: readonly Source[]) {
  const properties = new Set<string>();
  const bindings = new Set<string>();
  for (const { file, text } of sources) {
    for (const match of text.matchAll(
      /(?:[{,]\s*|\n\s*)([A-Za-z_$][\w$]*)\s*:\s*(?=['"`])/g,
    ))
      if (
        match[1] !== 'href' &&
        isMediaLiteral(literalAt(text, match.index + match[0].length))
      )
        properties.add(match[1]!);
    for (const match of text.matchAll(
      /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:\([^)]*\)\s*(?::\s*[\w$]+\s*)?=>\s*)?(?=['"`])/g,
    ))
      if (isMediaLiteral(literalAt(text, match.index + match[0].length)))
        bindings.add(`${file}#${match[1]}`);
  }
  return { properties, bindings };
}

/** The source file an import of `name` in `file` resolves to, if any. */
function importedFrom(file: string, text: string, name: string) {
  for (const match of text.matchAll(
    /import\s*\{([^}]*)\}\s*from\s*'(\.[^']*)'/g,
  ))
    if (match[1]!.split(',').some((part) => part.trim() === name))
      return normalize(join(dirname(file), match[2]!));
  return undefined;
}

/**
 * Every next/link, router.push and router.replace in `sources` that enters a
 * round media page client-side, by a literal href or by a computed one whose
 * builder is a media href literal.
 */
export function clientEntriesToMedia(
  sources: readonly Source[],
): readonly string[] {
  const { properties, bindings } = mediaBuilders(sources);
  const isBinding = (file: string, text: string, name: string) => {
    if (bindings.has(`${file}#${name}`)) return true;
    const from = importedFrom(file, text, name);
    return (
      from !== undefined &&
      ['.ts', '.tsx'].some((extension) =>
        bindings.has(`${from}${extension}#${name}`),
      )
    );
  };
  const isMedia = (file: string, text: string, expression: string) => {
    if (isLiteral(expression)) return isMediaLiteral(expression);
    const reference = expression.match(
      /^([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*)\s*(?:\(.*\))?$/s,
    );
    if (!reference) return false;
    const chain = reference[1]!.split(/\??\./);
    return chain.length === 1
      ? isBinding(file, text, chain[0]!)
      : properties.has(chain.at(-1)!);
  };
  return sources.flatMap(({ file, text }) => {
    const found: string[] = [];
    for (const match of text.matchAll(/<Link\b/g)) {
      const tag = text.slice(match.index, skipTagEnd(text, match.index));
      const href = tag.match(/\bhref=(?=[{'"])/);
      if (!href) continue;
      const start = href.index! + href[0].length;
      const expression =
        tag[start] === '{'
          ? tag.slice(start + 1, skipBalanced(tag, start) - 1).trim()
          : literalAt(tag, start);
      if (isMedia(file, text, expression))
        found.push(`${file}: <Link href={${expression}}>`);
    }
    for (const match of text.matchAll(/router\.(?:push|replace)(?=\()/g)) {
      const open = match.index + match[0].length;
      const argument = text
        .slice(open + 1, skipBalanced(text, open) - 1)
        .split(',')[0]!
        .trim();
      if (isMedia(file, text, argument))
        found.push(`${file}: ${match[0]}(${argument})`);
    }
    return found;
  });
}

/** Index of the `>` closing a JSX opening tag, skipping `{…}` attributes. */
function skipTagEnd(text: string, start: number): number {
  let i = start;
  while (i < text.length) {
    const char = text[i]!;
    if (char === '{') i = skipBalanced(text, i);
    else if (char === '"' || char === "'") i = skipLiteral(text, i);
    else if (char === '>') return i + 1;
    else i += 1;
  }
  return i;
}
