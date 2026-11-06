import { assert, setupRitewayBun, test } from 'riteway/bun';
import { scrubSpan } from './scrub-span';
setupRitewayBun();

test('streamed spans strip URL secrets, query attributes and SQL payloads without mutation', () => {
  const span = {
    name: 'GET https://daisy.test/room?token=secret',
    attributes: {
      'url.full': 'https://daisy.test/room?token=secret',
      'url.query': 'token=secret',
      'db.statement': 'select secret',
      'http.request.header.cookie': 'secret',
      'http.response.status_code': 200,
    },
    links: [
      { attributes: { 'url.full': 'https://daisy.test/room?token=secret' } },
    ],
  };
  const scrubbed = scrubSpan(span);
  assert({
    given:
      'streamed span name, URL, SQL, cookie and link attributes containing a secret',
    should: 'deliver none of that secret while preserving safe status',
    actual: [
      JSON.stringify(scrubbed).includes('secret'),
      scrubbed.attributes['http.response.status_code'],
      span.name.includes('secret'),
    ],
    expected: [false, 200, true],
  });
});
