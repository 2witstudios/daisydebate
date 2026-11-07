import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderBetaEmail } from './templates';

setupRitewayBun();

describe('beta mail templates (ADR 0075)', () => {
  test('the approval names the member and links to play, escaped', () => {
    const rendered = renderBetaEmail({
      kind: 'beta-approved',
      username: 'a<b>"c',
      url: 'https://daisy.example.com/play?x="y"&z=<1>',
    });
    assert({
      given: 'a username and link with markup characters',
      should: 'carry both in the text part and never raw in the HTML part',
      actual: {
        subject: rendered.subject,
        textNamesMember: rendered.text.includes('You\'re in, @a<b>"c.'),
        rawHtml:
          rendered.html.includes('a<b>"c') || rendered.html.includes('z=<1>'),
        escapedHtml: rendered.html.includes('a&lt;b&gt;&quot;c'),
      },
      expected: {
        subject: "You're in: Daisy Debate beta",
        textNamesMember: true,
        rawHtml: false,
        escapedHtml: true,
      },
    });
  });

  test('the owner digest counts, with no account detail', () => {
    const one = renderBetaEmail({
      kind: 'beta-requests',
      newRequests: 1,
      waiting: 1,
      url: 'http://localhost:4800/accounts?access=pending',
    });
    const many = renderBetaEmail({
      kind: 'beta-requests',
      newRequests: 3,
      waiting: 7,
      url: 'http://localhost:4800/accounts?access=pending',
    });
    assert({
      given: 'one and several new beta requests',
      should: 'pluralize the counts in the subject and body',
      actual: [
        one.subject,
        many.subject,
        many.text.includes('7 accounts now wait for review'),
      ],
      expected: [
        '1 account joined the beta list',
        '3 accounts joined the beta list',
        true,
      ],
    });
  });
});

test('an invitation has an ordinary sign-in destination without recipient or bearer authority', () => {
  const rendered = renderBetaEmail({
    kind: 'beta-invitation',
    url: 'https://daisy.example.com/sign-in',
  });
  const links = [...rendered.text.matchAll(/https:\/\/\S+/g)].map(
    (match) => new URL(match[0]),
  );
  assert({
    given: 'a beta invitation',
    should:
      'link to normal sign-in with no email or token and explain that forwarding grants no access',
    actual: [
      links.map((link) => [link.pathname, link.search]),
      rendered.text.includes('Forwarding this message grants no access'),
    ],
    expected: [[['/sign-in', '']], true],
  });
});
