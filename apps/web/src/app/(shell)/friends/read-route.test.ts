import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireSameOriginRead } from '../../../server/http';
import { renderReadHeaders } from './read-route';
setupRitewayBun();

const origin = 'https://daisy.invalid';
const refused = (headers: Headers) => {
  try {
    requireSameOriginRead(
      new Request(`${origin}/api/billing/settings`, { headers }),
      origin,
    );
    return false;
  } catch {
    return true;
  }
};

test("a render's own read does not carry the navigation that led to the page", () => {
  const arrival = new Headers({
    cookie: 'session=kept',
    'x-request-id': 'kept',
    origin: 'https://checkout.stripe.com',
    'sec-fetch-site': 'cross-site',
    'sec-fetch-mode': 'navigate',
  });
  const read = renderReadHeaders(arrival);
  assert({
    given: 'a page reached by a navigation from another site',
    should: 'drop the navigation metadata and keep the session and the rest',
    actual: [...read.entries()].sort(),
    expected: [
      ['cookie', 'session=kept'],
      ['sec-fetch-mode', 'navigate'],
      ['x-request-id', 'kept'],
    ],
  });
  assert({
    given: 'the same-origin read gate, before and after',
    should: 'refuse the raw navigation headers and admit the render read',
    actual: [refused(arrival), refused(read)],
    expected: [true, false],
  });
  assert({
    given: 'the navigation headers after the render read was derived',
    should: 'be left as they arrived',
    actual: arrival.get('sec-fetch-site'),
    expected: 'cross-site',
  });
});
