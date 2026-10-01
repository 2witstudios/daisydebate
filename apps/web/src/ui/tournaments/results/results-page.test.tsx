import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getResults } from '../../../features/tournaments/get-results';
import {
  defaultResultsQuery,
  type ResultsQuery,
} from '../../../features/tournaments/results';
import { Certificate } from '../certificate/certificate';
import { CertificatePage } from '../certificate/certificate-page';
import { ResultsPage, ResultsUnpublished } from './results-page';

setupRitewayBun();

const render = (
  id: string,
  query: Partial<ResultsQuery> = {},
  signedIn = true,
) => {
  const read = getResults(id, signedIn);
  if (read.kind !== 'results') throw new Error('no results');
  return renderToString(
    h(ResultsPage, {
      data: read.data,
      query: { ...defaultResultsQuery, ...query },
      viewerHandle: signedIn ? 'debater-a' : null,
    }),
  );
};

describe('ResultsPage', () => {
  test('the champion, four tabs and the top eight', () => {
    const html = render('summer-invitational');
    assert({
      given: 'Summer Invitational standings',
      should:
        'show the champion, all four tabs, eight rows and a show-all link',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes('Champion, Summer Invitational'),
        html.includes('aria-label="Results sections"'),
        html.includes('Your result'),
        html.match(/<tr class="border-t/g)?.length,
        html.includes('href="/tournaments/summer-invitational/results?all=1"'),
        html.includes('>You<'),
      ],
      expected: [1, true, true, true, 8, true, true],
    });
  });

  test('show all lists every entrant', () => {
    const html = render('summer-invitational', { all: true });
    assert({
      given: 'all=1',
      should: 'list sixteen rows and drop the link',
      actual: [
        html.match(/<tr class="border-t/g)?.length,
        html.includes('Show all 16'),
      ],
      expected: [16, false],
    });
  });

  test('last rounds and honours', () => {
    const rounds = render('summer-invitational', { tab: 'rounds' });
    const honours = render('summer-invitational', { tab: 'honours' });
    assert({
      given: 'the rounds and honours tabs',
      should: 'list the final, and the four honours with the no-rating note',
      actual: [
        rounds.includes('@debater-c</b> beat @debater-a'),
        rounds.includes('Judge @judge-a'),
        honours.match(
          /<li class="flex items-start gap-3 rounded-lg border border-gold-border/g,
        )?.length,
        honours.includes('never change'),
      ],
      expected: [true, true, 4, true],
    });
  });

  test('your result: honour, certificate link, preview', () => {
    const html = render('summer-invitational', { tab: 'mine' });
    assert({
      given: 'the viewer’s result',
      should:
        'show the placing, link the certificate, disable copy and preview it',
      actual: [
        html.includes('You placed second.'),
        html.includes('Runner-up, honour earned'),
        html.includes(
          'href="/tournaments/mine/summer-invitational/certificate"',
        ),
        /<button type="button" disabled=""[^>]*>Copy link to results</.test(
          html,
        ),
        html.includes('aria-label="Certificate preview"'),
        html.includes('Final</span>') || html.includes('Final vs @debater-c'),
      ],
      expected: [true, true, true, true, true, true],
    });
  });

  test('signed out: no Your result tab; a round robin has no personal result', () => {
    const out = render('summer-invitational', {}, false);
    const robin = render('midsummer-round-robin');
    assert({
      given: 'an anonymous visitor, and a round robin',
      should: 'hide the personal tab and still show standings',
      actual: [
        out.includes('Your result'),
        robin.includes('Your result'),
        robin.includes('@debater-d'),
        robin.match(/<tr class="border-t/g)?.length,
      ],
      expected: [false, false, true, 6],
    });
  });
});

describe('ResultsUnpublished', () => {
  test('explains and links back', () => {
    const html = renderToString(
      h(ResultsUnpublished, { name: 'Harvest Cup', id: 'harvest-cup' }),
    );
    assert({
      given: 'a tournament without results',
      should: 'say so and link back',
      actual: [
        html.includes('Harvest Cup has no published results'),
        html.includes('href="/tournaments/harvest-cup"'),
      ],
      expected: [true, true],
    });
  });
});

describe('Certificate', () => {
  test('the certificate and its page', () => {
    const read = getResults('summer-invitational', true);
    if (read.kind !== 'results' || !read.data.mine)
      throw new Error('no result');
    const { tournament, mine } = read.data;
    const certificate = renderToString(
      h(Certificate, { tournament, certificate: mine.certificate }),
    );
    const page = renderToString(h(CertificatePage, { tournament, mine }));
    assert({
      given: 'the runner-up certificate',
      should:
        'read as a certificate, and the page hides its controls when printed',
      actual: [
        certificate.includes('aria-label="Certificate of recognition"'),
        certificate.includes('Certificate of Recognition'),
        certificate.includes('@debater-a'),
        certificate.includes('placed second as runner-up'),
        certificate.includes('Certificate cert-sample-0001 (sample)'),
        page.match(/<h1 /g)?.length,
        page.includes('print:hidden'),
        page.includes('href="/tournaments/summer-invitational/results"'),
      ],
      expected: [true, true, true, true, true, 1, true, true],
    });
  });
});
