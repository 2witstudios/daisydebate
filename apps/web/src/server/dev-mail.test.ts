import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  captureMail,
  fileRecorder,
  readDevMailFile,
  type CapturedMail,
} from './dev-mail';

setupRitewayBun();

const clock = { now: () => '2026-10-03T12:00:00.000Z' };

const resendCall = {
  method: 'POST',
  body: JSON.stringify({
    from: 'Daisy <no-reply@example.test>',
    to: ['Me@Example.test'],
    subject: 'Sign in to Daisy Debate',
    text: 'Open https://localhost:3000/auth/confirm?token=abc',
  }),
};

describe('readDevMailFile', () => {
  test('off unless the variable names a file', () => {
    assert({
      given: 'no variable and an empty one',
      should: 'leave capture off',
      actual: [
        readDevMailFile({ NODE_ENV: 'development' }),
        readDevMailFile({ NODE_ENV: 'development', DEV_MAIL_CAPTURE: '' }),
      ],
      expected: [null, null],
    });
  });

  test('on in development with an absolute path', () => {
    assert({
      given: 'a development environment naming an absolute file',
      should: 'return that file',
      actual: readDevMailFile({
        NODE_ENV: 'development',
        DEV_MAIL_CAPTURE: '/tmp/mail.jsonl',
      }),
      expected: '/tmp/mail.jsonl',
    });
  });

  test('production refuses it, naming only the field', () => {
    let message = '';
    try {
      readDevMailFile({
        NODE_ENV: 'production',
        DEV_MAIL_CAPTURE: '/tmp/secret-path.jsonl',
      });
    } catch (error) {
      message = (error as Error).message;
    }
    assert({
      given: 'production with capture switched on',
      should: 'refuse to start and not echo the value',
      actual: [
        message.includes('DEV_MAIL_CAPTURE is development-only'),
        message.includes('secret-path'),
      ],
      expected: [true, false],
    });
  });

  test('a relative path is refused', () => {
    assert({
      given: 'a relative path',
      should: 'refuse it',
      actual: (() => {
        try {
          return readDevMailFile({
            NODE_ENV: 'development',
            DEV_MAIL_CAPTURE: 'mail.jsonl',
          });
        } catch (error) {
          return (error as Error).message;
        }
      })(),
      expected:
        'Invalid configuration: DEV_MAIL_CAPTURE must be an absolute path',
    });
  });
});

describe('captureMail', () => {
  test('answers the Resend call locally and records the message', async () => {
    const recorded: CapturedMail[] = [];
    let reachedNetwork = false;
    const fetchImpl = captureMail({
      downstream: async () => {
        reachedNetwork = true;
        return new Response(null);
      },
      record: (mail) => recorded.push(mail),
      clock,
    });
    const response = await fetchImpl(
      'https://api.resend.com/emails',
      resendCall,
    );
    assert({
      given: 'the sender calling Resend',
      should:
        'accept it, keep the lower-cased recipient, and not hit the network',
      actual: [response.status, recorded, reachedNetwork],
      expected: [
        200,
        [
          {
            to: 'me@example.test',
            subject: 'Sign in to Daisy Debate',
            text: 'Open https://localhost:3000/auth/confirm?token=abc',
            at: '2026-10-03T12:00:00.000Z',
          },
        ],
        false,
      ],
    });
  });

  test('any other request passes through', async () => {
    const seen: string[] = [];
    const fetchImpl = captureMail({
      downstream: async (input) => {
        seen.push(String(input));
        return new Response(null, { status: 204 });
      },
      record: () => seen.push('recorded'),
      clock,
    });
    const response = await fetchImpl('https://example.test/other');
    assert({
      given: 'a request that is not the Resend call',
      should: 'go downstream untouched and record nothing',
      actual: [response.status, seen],
      expected: [204, ['https://example.test/other']],
    });
  });
});

describe('fileRecorder', () => {
  test('appends one JSON line per message, creating the folder', () => {
    const file = join(
      mkdtempSync(join(tmpdir(), 'dev-mail-')),
      'nested',
      'mail.jsonl',
    );
    const record = fileRecorder(file);
    const mail = { to: 'a@example.test', subject: 's', text: 't', at: 'x' };
    record(mail);
    record({ ...mail, to: 'b@example.test' });
    assert({
      given: 'two messages',
      should: 'write two lines in order',
      actual: readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map((line) => (JSON.parse(line) as CapturedMail).to),
      expected: ['a@example.test', 'b@example.test'],
    });
  });
});
