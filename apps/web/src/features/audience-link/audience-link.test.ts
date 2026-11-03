import { createHash } from 'node:crypto';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  audienceAdmits,
  audienceLinkCookie,
  audienceLinkHash,
  audienceLinkHref,
  newAudienceLinkToken,
  presentedLinkHash,
} from './audience-link';

setupRitewayBun();

const roundId = 'abcdefghijklmnopqrstuvwx';
const token = newAudienceLinkToken((bytes) => new Uint8Array(bytes).fill(7));

describe('the audience link token', () => {
  test('is 256 bits of the injected entropy, stored only as its hash', () => {
    assert({
      given: '32 random bytes',
      should: 'encode them all for a URL and a cookie',
      actual: token,
      expected: Buffer.from(new Uint8Array(32).fill(7)).toString('base64url'),
    });
    assert({
      given: 'a token',
      should: 'hash it with SHA3-256',
      actual: audienceLinkHash(token),
      expected: createHash('sha3-256').update(token).digest('hex'),
    });
    assert({
      given: 'the default entropy, twice',
      should: 'never repeat',
      actual: newAudienceLinkToken() === newAudienceLinkToken(),
      expected: false,
    });
  });

  test('the link it makes', () => {
    assert({
      given: 'a Round and a token',
      should: 'name the one route that opens it',
      actual: audienceLinkHref(roundId, token),
      expected: `/watch/${roundId}/link?token=${token}`,
    });
  });
});

describe('who the link admits', () => {
  const unlisted = {
    visibility: 'unlisted',
    audienceLinkHash: audienceLinkHash(token),
  } as const;

  test('a public Round needs no link', () => {
    assert({
      given: 'a public Round and no link',
      should: 'admit',
      actual: audienceAdmits(
        { visibility: 'public', audienceLinkHash: null },
        null,
      ),
      expected: true,
    });
  });

  test('an unlisted Round needs its current link', () => {
    assert({
      given: 'no link',
      should: 'refuse',
      actual: audienceAdmits(unlisted, null),
      expected: false,
    });
    assert({
      given: 'a wrong link',
      should: 'refuse',
      actual: audienceAdmits(unlisted, audienceLinkHash('wrong')),
      expected: false,
    });
    assert({
      given: 'the current link',
      should: 'admit',
      actual: audienceAdmits(unlisted, audienceLinkHash(token)),
      expected: true,
    });
    assert({
      given: 'a Round whose host has issued no link',
      should: 'refuse even a presented one',
      actual: audienceAdmits(
        { visibility: 'unlisted', audienceLinkHash: null },
        audienceLinkHash(token),
      ),
      expected: false,
    });
  });

  test('a link never opens anything else', () => {
    assert({
      given: 'a private Round and a matching hash',
      should: 'refuse',
      actual: audienceAdmits(
        { visibility: 'private', audienceLinkHash: audienceLinkHash(token) },
        audienceLinkHash(token),
      ),
      expected: false,
    });
    assert({
      given: 'a Round with no audience recorded',
      should: 'refuse',
      actual: audienceAdmits(
        { visibility: null, audienceLinkHash: null },
        null,
      ),
      expected: false,
    });
  });
});

describe('the browser holding a link', () => {
  test('the cookie', () => {
    const cookie = audienceLinkCookie(roundId, token, { secure: true });
    assert({
      given: 'an https deployment',
      should: 'hold the token out of reach of script, for one week',
      actual: cookie,
      expected: `daisy_audience_link_${roundId}=${token}; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax; Secure`,
    });
    assert({
      given: 'local http',
      should: 'leave Secure off so the browser keeps it',
      actual: audienceLinkCookie(roundId, token, { secure: false }).includes(
        'Secure',
      ),
      expected: false,
    });
  });

  test('what a request presents', () => {
    const name = `daisy_audience_link_${roundId}`;
    assert({
      given: 'its cookie among others',
      should: 'present the hash of the token',
      actual: presentedLinkHash(`a=b; ${name}=${token}; c=d`, roundId),
      expected: audienceLinkHash(token),
    });
    assert({
      given: 'no cookie header',
      should: 'present nothing',
      actual: presentedLinkHash(null, roundId),
      expected: null,
    });
    assert({
      given: 'another Round’s cookie',
      should: 'present nothing',
      actual: presentedLinkHash(
        `daisy_audience_link_zzzzzzzzzzzzzzzzzzzzzzzz=${token}`,
        roundId,
      ),
      expected: null,
    });
    assert({
      given: 'a value no token could be',
      should: 'present nothing',
      actual: presentedLinkHash(`${name}=short`, roundId),
      expected: null,
    });
  });
});
