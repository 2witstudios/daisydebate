import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { classify, MAX_RECORD_BYTES } from './ship';
import {
  app,
  apps,
  encode,
  line,
  receivedAt,
  record,
  subject,
  valid,
} from './ship.test-support';

setupRitewayBun();

const reasonOf = (subjectText: string, data: Uint8Array) => {
  const result = classify({ subject: subjectText, data, apps, receivedAt });
  return result.kind === 'row' ? 'row' : `${result.app}:${result.reason}`;
};
describe('classify', () => {
  test('stores an admitted line placed where its subject says', () => {
    assert({
      given: 'a logger line whose envelope agrees with its subject',
      should: 'become a row',
      actual: reasonOf(subject, valid),
      expected: 'row',
    });
  });

  test('refuses every untrusted record with a closed reason', () => {
    const late = record(
      JSON.stringify({ ...line, time: line.time - 2 * 3_600_000 }),
    );
    const early = record(
      JSON.stringify({ ...line, time: line.time + 10 * 60_000 }),
    );
    assert({
      given:
        'a foreign or malformed subject, an oversize record, an envelope that disagrees with its subject, a non-logger line and source times far from receipt',
      should: 'drop each, attributed to a configured app or to unknown',
      actual: [
        reasonOf('logs.daisy-debate-production.ord.811006b93572d8', valid),
        reasonOf(`metrics.${app}.ord.811006b93572d8`, valid),
        reasonOf(`${subject}.extra`, valid),
        reasonOf(subject, new Uint8Array(MAX_RECORD_BYTES + 1)),
        reasonOf(subject, encode('garbage')),
        reasonOf(subject, record(JSON.stringify(line), { region: 'iad' })),
        reasonOf(subject, record(JSON.stringify(line), { instance: 'aaaa' })),
        reasonOf(subject, record('Next.js ready')),
        reasonOf(subject, late),
        reasonOf(subject, early),
      ],
      expected: [
        'unknown:app',
        'unknown:app',
        'unknown:app',
        `${app}:size`,
        `${app}:envelope`,
        `${app}:envelope`,
        `${app}:envelope`,
        `${app}:json`,
        `${app}:time`,
        `${app}:time`,
      ],
    });
  });
});
