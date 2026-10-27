import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createLogger } from './index';
import { admitLogLine } from './ingest';

setupRitewayBun();

const base = {
  level: 40,
  time: 1_793_106_113_439,
  pid: 7,
  hostname: '811006b93572d8',
  service: 'web',
  appVersion: '7d94b6b',
  gitCommit: '7d94b6b153b556dabe0346bc2b727f989905e436',
  event: 'auth.rate_limit.denied',
  msg: 'Rate limit denied',
};
const line = (entry: Record<string, unknown>) => JSON.stringify(entry);

describe('admitLogLine', () => {
  test('admits what the logger itself writes', () => {
    let output = '';
    const logger = createLogger({
      service: 'web',
      appVersion: '7d94b6b',
      gitCommit: '7d94b6b153b556dabe0346bc2b727f989905e436',
      destination: { write: (text) => (output += text) },
    });
    logger.log(
      'auth.rate_limit.denied',
      { operation: 'auth.sign-in', path: '/api/auth/sign-in', status: 429 },
      'Rate limit denied',
    );
    const admitted = admitLogLine(output.trim());
    assert({
      given:
        'a line the logger emitted under digit-leading short and full SHAs',
      should: 'admit its event, base fields and allowlisted fields only',
      actual: admitted.ok && {
        event: admitted.entry.event,
        severity: admitted.entry.severity,
        service: admitted.entry.service,
        appVersion: admitted.entry.appVersion,
        gitCommit: admitted.entry.gitCommit,
        fields: admitted.entry.fields,
      },
      expected: {
        event: 'auth.rate_limit.denied',
        severity: 'warn',
        service: 'web',
        appVersion: '7d94b6b',
        gitCommit: '7d94b6b153b556dabe0346bc2b727f989905e436',
        fields: {
          operation: 'auth.sign-in',
          path: '/api/auth/sign-in',
          status: 429,
        },
      },
    });
  });

  test('keeps the time as a UTC ISO timestamp', () => {
    const admitted = admitLogLine(line(base));
    assert({
      given: 'an epoch-millisecond pino time',
      should: 'carry it as a UTC ISO timestamp',
      actual: admitted.ok && admitted.entry.at,
      expected: new Date(base.time).toISOString(),
    });
  });

  test('never carries the message, pid or hostname', () => {
    const admitted = admitLogLine(line(base));
    assert({
      given: 'a valid line with pino envelope keys',
      should: 'leave the message, pid and hostname out of the entry',
      actual: admitted.ok && Object.keys(admitted.entry).sort(),
      expected: [
        'appVersion',
        'at',
        'event',
        'fields',
        'gitCommit',
        'service',
        'severity',
      ],
    });
  });

  test('drops each kind of untrusted line with a closed reason', () => {
    const cases: readonly [string, string][] = [
      ['not json', 'json'],
      ['[1,2]', 'json'],
      ['null', 'json'],
      [line({ ...base, event: 'made.up' }), 'event'],
      [line({ ...base, event: 42 }), 'event'],
      [line({ ...base, level: 30 }), 'level'],
      [line({ ...base, time: 'yesterday' }), 'base'],
      [line({ ...base, service: 'web service' }), 'base'],
      [line({ ...base, gitCommit: undefined }), 'base'],
      [line({ ...base, email: 'someone@example.com' }), 'field'],
      [line({ ...base, userId: 'has space' }), 'field'],
      [line({ ...base, status: -1 }), 'field'],
      [line({ ...base, err: { message: 'boom' } }), 'field'],
    ];
    assert({
      given:
        'malformed JSON, an unregistered event, a wrong level, a bad base field or a field outside the allowlist',
      should: 'drop the whole line with its reason',
      actual: cases.map(([text]) => {
        const result = admitLogLine(text);
        return result.ok ? 'admitted' : result.reason;
      }),
      expected: cases.map(([, reason]) => reason),
    });
  });

  test('refuses an oversized line before parsing it', () => {
    const result = admitLogLine(
      line({ ...base, operation: 'x'.repeat(20_000) }),
    );
    assert({
      given: 'a line longer than any logger line can be',
      should: 'drop it as json',
      actual: result.ok ? 'admitted' : result.reason,
      expected: 'json',
    });
  });

  test('loads no logger runtime', async () => {
    const imports = async (file: string) =>
      new Bun.Transpiler({ loader: 'ts' })
        .scanImports(await Bun.file(new URL(file, import.meta.url)).text())
        .map((entry) => entry.path);
    assert({
      given: 'the ingest admission and the vocabulary it reads',
      should: 'import nothing but the vocabulary, so pino never loads',
      actual: {
        ingest: await imports('./ingest.ts'),
        vocabulary: await imports('./vocabulary.ts'),
      },
      expected: { ingest: ['./vocabulary'], vocabulary: [] },
    });
  });
});
