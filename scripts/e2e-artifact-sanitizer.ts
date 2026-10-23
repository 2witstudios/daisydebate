/**
 * AUTH-6.1: retained Playwright artifacts (server.log, the HTML report, and
 * trace/network archives) can carry a live magic-link token, a session
 * cookie, a private key, or the e2e placeholder secrets baked into
 * playwright.config.ts's webServer.env. This redacts those before upload; it never deletes an
 * artifact, only the sensitive substrings inside it.
 */
import {
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const redactions: readonly (readonly [RegExp, string])[] = [
  // Ticket responses and hello frames may be nested JSON inside trace records.
  // Preserve the surrounding quote/escape framing while removing bearer data.
  [
    /((?:\\*)"(?:ticket|token)(?:\\*)"\s*:\s*(?:\\*)")[A-Za-z0-9_-]+((?:\\*)")/g,
    '$1[REDACTED]$2',
  ],
  // The confirmation page carries the magic-link token in a hidden input
  // (ISSUE-487), in served HTML, server.log and trace DOM snapshots alike.
  [/(name=(?:\\*)"token(?:\\*)"\s+value=(?:\\*)")[^"\\]*/gi, '$1[REDACTED]'],
  // Any PEM private key, such as the e2e TLS edge's (ISSUE-78): an artifact
  // must never carry key material, however short-lived.
  [
    /-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY-----[\s\S]*?-----END \1PRIVATE KEY-----/g,
    '[REDACTED PRIVATE KEY]',
  ],
  [/token=[^&\s"'<>]+/gi, 'token=[REDACTED]'],
  [/"cookie"\s*:\s*"[^"]*"/gi, '"cookie":"[REDACTED]"'],
  [/set-cookie:\s*[^\r\n]+/gi, 'set-cookie: [REDACTED]'],
  [/cookie:\s*[^\r\n]+/gi, 'cookie: [REDACTED]'],
  [/authorization:\s*[^\r\n]+/gi, 'authorization: [REDACTED]'],
  [/(__Secure-[\w.-]+)=([^;,\s"'&]+)/g, '$1=[REDACTED]'],
  // The e2e placeholder credentials from playwright.config.ts webServer.env —
  // never a live secret, but redacted anyway so a diff of retained artifacts
  // never trains a reader to recognize the shape of a real one.
  [
    /e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0/g,
    '[REDACTED]',
  ],
  [
    /a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2/g,
    '[REDACTED]',
  ],
  [/re_e2e_placeholder_not_a_credential/g, '[REDACTED]'],
  [/whsec_ZTJlLXBsYWNlaG9sZGVyLW5vdC1hLXNlY3JldA==/g, '[REDACTED]'],
];

/**
 * By shape, for free text only: an emailed-link token is 32 random bytes in
 * base64url, exactly 43 characters. A run is redacted only when the whole
 * base64-like run is that token shape; standard base64 (with +, / or =) and
 * longer runs are encoded payloads, never rewritten in place (ISSUE-487-r1).
 * A run opening with -- is a CSS custom property or a CLI flag, not a token.
 */
const redactTokenShapes = (text: string): string =>
  // = only ever pads the end of base64, so key=value text splits into runs.
  text.replace(/[A-Za-z0-9+/_-]{43,}={0,2}/g, (run) =>
    /^(?!--)[A-Za-z0-9_-]{43}$/.test(run) ? '[REDACTED]' : run,
  );

const redactFreeText = (text: string): string =>
  redactTokenShapes(
    redactions.reduce(
      (value, [pattern, replacement]) => value.replace(pattern, replacement),
      text,
    ),
  );

const textualMedia = /^(text\/[\w.+-]+|application\/(json|[\w.+-]+\+json))$/i;

/**
 * A data: URI is a payload, not text: an embedded zip (the HTML report's
 * results) is decoded, sanitized entry by entry and re-encoded; a textual one
 * is decoded, redacted and re-encoded; binary media is left untouched.
 */
function redactDataUri(media: string, payload: string): string {
  if (/^application\/zip$/i.test(media)) {
    const decoded = Buffer.from(payload, 'base64');
    const sanitized = sanitizeZipBuffer(decoded);
    return sanitized === decoded ? payload : sanitized.toString('base64');
  }
  if (!textualMedia.test(media)) return payload;
  const decoded = Buffer.from(payload, 'base64').toString('utf8');
  const redacted = redactText(decoded);
  return redacted === decoded
    ? payload
    : Buffer.from(redacted, 'utf8').toString('base64');
}

const redactPlain = (text: string): string => {
  const dataUri = /data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/]+={0,2})/g;
  let output = '',
    last = 0;
  for (const match of text.matchAll(dataUri)) {
    output += redactFreeText(text.slice(last, match.index));
    output += `data:${match[1]};base64,${redactDataUri(match[1]!, match[2]!)}`;
    last = match.index + match[0].length;
  }
  return output + redactFreeText(text.slice(last));
};

function parsedJson(text: string): { value: unknown } | null {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return null;
  }
}

function redactJson(value: unknown, depth: number): unknown {
  if (depth > 64)
    throw new Error('Artifact JSON nesting exceeds the redaction bound');
  if (typeof value === 'string') {
    const nested = parsedJson(value);
    if (!nested) return redactPlain(value);
    return formatRedactedJson(
      value,
      nested.value,
      redactJson(nested.value, depth + 1),
    );
  }
  if (Array.isArray(value))
    return value.map((item) => redactJson(item, depth + 1));
  if (value !== null && typeof value === 'object')
    return redactJsonObject(value, depth);
  return value;
}

function redactJsonObject(value: object, depth: number): object {
  const entries = Object.entries(value);
  const header = entries.find(([key]) => key === 'name')?.[1];
  const headerValue =
    typeof header === 'string' &&
    (/^(cookie|set-cookie|authorization|token)$/i.test(header) ||
      /^__Secure-[\w.-]+$/.test(header));
  return Object.fromEntries(
    entries.map(([key, item]) => [
      key,
      typeof item === 'string' &&
      (/^(ticket|token|cookie|set-cookie|authorization)$/i.test(key) ||
        // A DOM snapshot keeps an input's live value in __playwright_value_.
        ((key === 'value' || key === '__playwright_value_') && headerValue))
        ? '[REDACTED]'
        : redactJson(item, depth + 1),
    ]),
  );
}

function redactJsonRecord(text: string): string | null {
  if (!/^\s*[[{"]/.test(text)) return null;
  const parsed = parsedJson(text);
  if (!parsed) return null;
  return formatRedactedJson(text, parsed.value, redactJson(parsed.value, 0));
}

function formatRedactedJson(
  text: string,
  value: unknown,
  sanitized: unknown,
): string {
  const original = JSON.stringify(value);
  const redacted = JSON.stringify(sanitized);
  if (original === redacted) return text;
  return (
    (text.match(/^\s*/)?.[0] ?? '') + redacted + (text.match(/\s*$/)?.[0] ?? '')
  );
}

export function redactText(text: string): string {
  const whole = redactJsonRecord(text);
  if (whole !== null) return whole;
  const output: string[] = [];
  let plain = '';
  const flush = () => {
    output.push(redactPlain(plain));
    plain = '';
  };
  for (const line of text.split(/(?<=\n)/)) {
    const record = redactJsonRecord(line);
    if (record === null) plain += line;
    else {
      flush();
      output.push(record);
    }
  }
  flush();
  return output.join('');
}

const binaryExtension = /\.(png|jpe?g|webp|gif|woff2?|ttf|otf|ico)$/i;
const zipExtension = /\.zip$/i;

function isProbablyBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 512).includes(0);
}

function sanitizeTextFileInPlace(path: string): boolean {
  const buffer = readFileSync(path);
  if (isProbablyBinary(buffer)) return false;
  const original = buffer.toString('utf8');
  const redacted = redactText(original);
  if (redacted === original) return false;
  writeFileSync(path, redacted, 'utf8');
  return true;
}

function walk(directory: string): readonly string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    const info = statSync(absolute);
    if (info.isDirectory()) files.push(...walk(absolute));
    else files.push(absolute);
  }
  return files;
}

function sanitizeZipInPlace(zipPath: string): boolean {
  const extractDir = mkdtempSync(join(tmpdir(), 'daisy-e2e-sanitize-'));
  try {
    const extracted = Bun.spawnSync([
      'unzip',
      '-qq',
      '-o',
      zipPath,
      '-d',
      extractDir,
    ]);
    // An archive this scan cannot open cannot be proven clean either: a
    // corrupt or unreadable trace/network zip must block publication, not
    // pass through unredacted under a "nothing changed" result.
    if (extracted.exitCode !== 0)
      throw new Error(
        `could not extract ${zipPath} for sanitization (unzip exited ${extracted.exitCode}: ${extracted.stderr?.toString().trim()}); refusing to publish an unscanned archive`,
      );
    let changed = false;
    for (const file of walk(extractDir)) {
      if (binaryExtension.test(file)) continue;
      if (sanitizeTextFileInPlace(file)) changed = true;
    }
    if (!changed) return false;
    // zip runs inside extractDir, so its output path must be absolute; the
    // original is replaced only once a complete redacted archive exists.
    const rezippedPath = `${resolve(zipPath)}.sanitized`;
    const rezipped = Bun.spawnSync(['zip', '-qr', rezippedPath, '.'], {
      cwd: extractDir,
    });
    if (rezipped.exitCode !== 0) {
      rmSync(rezippedPath, { force: true });
      throw new Error(
        `could not rezip sanitized archive ${zipPath} (zip exited ${rezipped.exitCode}: ${rezipped.stderr?.toString().trim()})`,
      );
    }
    renameSync(rezippedPath, zipPath);
    return true;
  } finally {
    rmSync(extractDir, { recursive: true, force: true });
  }
}

/** The same archive scan for a zip held in memory; the input itself when nothing changed. */
function sanitizeZipBuffer(zip: Buffer): Buffer {
  const directory = mkdtempSync(join(tmpdir(), 'daisy-e2e-embedded-'));
  try {
    const path = join(directory, 'embedded.zip');
    writeFileSync(path, zip);
    return sanitizeZipInPlace(path) ? readFileSync(path) : zip;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function sanitizeArtifactTree(root: string): {
  scanned: number;
  redacted: number;
} {
  let scanned = 0;
  let redacted = 0;
  let entries: readonly string[];
  try {
    entries = walk(root);
  } catch {
    return { scanned, redacted };
  }
  for (const file of entries) {
    scanned += 1;
    if (zipExtension.test(file)) {
      if (sanitizeZipInPlace(file)) redacted += 1;
      continue;
    }
    if (binaryExtension.test(file)) continue;
    if (sanitizeTextFileInPlace(file)) redacted += 1;
  }
  return { scanned, redacted };
}

if (import.meta.main) {
  const roots = process.argv.slice(2);
  if (roots.length === 0) {
    console.error(
      'usage: bun scripts/e2e-artifact-sanitizer.ts <dir> [dir...]',
    );
    process.exitCode = 1;
  } else {
    for (const root of roots) {
      const { scanned, redacted } = sanitizeArtifactTree(root);
      console.log(
        `sanitized ${root}: scanned ${scanned} file(s), redacted ${redacted}`,
      );
    }
  }
}
