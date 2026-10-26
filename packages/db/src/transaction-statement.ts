type Refuse = (message: string) => never;
const control = 'Transaction controls and configuration are adapter-owned';
const identifier = /^[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_$\u0080-\uFFFF]*/;
const dollarQuote =
  /^\$(?:[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_\u0080-\uFFFF]*)?\$/;
const escapePrefix = (text: string, at: number) =>
  (text[at] === 'E' || text[at] === 'e') && text[at + 1] === "'";

function blockEnd(text: string, start: number): number {
  let depth = 1;
  let at = start + 2;
  while (depth > 0 && at < text.length) {
    const pair = text.slice(at, at + 2);
    if (pair === '/*') {
      depth += 1;
      at += 2;
    } else if (pair === '*/') {
      depth -= 1;
      at += 2;
    } else at += 1;
  }
  return at;
}

function quoteEnd(text: string, start: number, escape: boolean): number {
  const quote = text[start];
  let at = start + 1;
  while (at < text.length) {
    if (escape && text[at] === '\\') at += 2;
    else if (text[at] !== quote) at += 1;
    else if (text[at + 1] === quote) at += 2;
    else return at + 1;
  }
  return at;
}

/** PostgreSQL lexical boundaries, with standard_conforming_strings pinned on. */
class SqlIdentifiers {
  private at = 0;
  private readonly names: string[] = [];
  private literalEnd: number | null = null;
  private literalEscapes = false;
  constructor(
    private readonly text: string,
    private readonly refuse: Refuse,
  ) {}

  private trivia(): boolean {
    const rest = this.text.slice(this.at);
    const whitespace = /^\s+/.exec(rest)?.[0];
    if (whitespace) this.at += whitespace.length;
    else if (rest.startsWith('--')) {
      const end = /[\r\n]/.exec(rest)?.index;
      this.at = end === undefined ? this.text.length : this.at + end + 1;
    } else if (rest.startsWith('/*')) this.at = blockEnd(this.text, this.at);
    else return false;
    return true;
  }

  private continuedEscape(): boolean {
    return (
      this.literalEscapes &&
      this.literalEnd !== null &&
      /[\r\n]/.test(this.text.slice(this.literalEnd, this.at))
    );
  }

  private string(): boolean {
    if (escapePrefix(this.text, this.at)) {
      this.at = quoteEnd(this.text, this.at + 1, true);
      this.literalEscapes = true;
    } else if (this.text[this.at] === "'") {
      this.literalEscapes = this.continuedEscape();
      this.at = quoteEnd(this.text, this.at, this.literalEscapes);
    } else {
      const tag = dollarQuote.exec(this.text.slice(this.at))?.[0];
      if (!tag) return false;
      const end = this.text.indexOf(tag, this.at + tag.length);
      this.at = end < 0 ? this.text.length : end + tag.length;
      this.literalEscapes = false;
    }
    this.literalEnd = this.at;
    return true;
  }

  private name(): boolean {
    if (this.text[this.at] === '"') {
      // The adapter's schema identifiers are canonical ASCII. Fail closed for
      // U& identifiers, including custom UESCAPE, rather than partially decode them.
      if (this.text.slice(this.at - 2, this.at).toLowerCase() === 'u&')
        this.refuse(control);
      const end = quoteEnd(this.text, this.at, false);
      this.names.push(
        this.text
          .slice(this.at + 1, end - 1)
          .replaceAll('""', '"')
          .toLowerCase(),
      );
      this.at = end;
    } else {
      const value = identifier.exec(this.text.slice(this.at))?.[0];
      if (!value) return false;
      this.names.push(value.toLowerCase());
      this.at += value.length;
    }
    this.literalEnd = null;
    return true;
  }

  read(): readonly string[] {
    while (this.at < this.text.length) {
      if (this.trivia() || this.string() || this.name()) continue;
      this.literalEnd = null;
      this.at += 1;
    }
    return this.names;
  }
}

/** Prepared protocol rejects multiple statements; configuration names never enter it. */
export function assertTransactionStatement(text: string, refuse: Refuse): void {
  const names = new SqlIdentifiers(text, refuse).read();
  if (
    ![
      'select',
      'with',
      'insert',
      'update',
      'delete',
      'values',
      'show',
      'explain',
    ].includes(names[0] ?? '') ||
    names.some((name) => ['set_config', 'pg_settings'].includes(name))
  )
    refuse(control);
}
