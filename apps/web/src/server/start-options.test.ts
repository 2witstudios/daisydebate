import { expect } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readStartOptions } from './start-options';

setupRitewayBun();

test('the listen address defaults to every interface', () => {
  assert({
    given: 'a production environment without LISTEN_HOST',
    should: 'listen on 0.0.0.0 at the default port',
    actual: readStartOptions({ NODE_ENV: 'production' }),
    expected: { port: 3000, host: '0.0.0.0' },
  });
});

test('a blank listen address listens on every interface', () => {
  assert({
    given: 'LISTEN_HOST set but blank',
    should: 'listen on 0.0.0.0, as a blank REALTIME_HOST does',
    actual: readStartOptions({ NODE_ENV: 'production', LISTEN_HOST: ' ' }).host,
    expected: '0.0.0.0',
  });
});

test('a loopback listen address is kept', () => {
  assert({
    given: 'LISTEN_HOST=127.0.0.1',
    should: 'listen on loopback only',
    actual: readStartOptions({
      NODE_ENV: 'production',
      LISTEN_HOST: '127.0.0.1',
    }).host,
    expected: '127.0.0.1',
  });
});

test('a listen address that is not an IP literal is refused', () => {
  expect(() =>
    readStartOptions({ NODE_ENV: 'production', LISTEN_HOST: 'localhost' }),
  ).toThrow('Invalid LISTEN_HOST: localhost');
});
