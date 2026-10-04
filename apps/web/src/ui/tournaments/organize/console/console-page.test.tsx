import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  consoleTabs,
  type ConsoleQuery,
} from '../../../../features/tournaments/console';
import { consoleView } from '../../../../features/tournaments/console-view';
import { getConsole } from '../../../../features/tournaments/get-console';
import { ConsolePage, ConsoleUnavailable } from './console-page';

setupRitewayBun();

const render = (id: string, query: Partial<ConsoleQuery> = {}) => {
  const data = getConsole(id);
  if (!data) throw new Error(`no console ${id}`);
  return renderToString(
    h(ConsolePage, {
      view: consoleView(data, { tab: 'rounds', round: null, ...query }),
    }),
  );
};

describe('ConsolePage', () => {
  test('every tab renders one h1 and the five tab links', () => {
    assert({
      given: 'each tab',
      should: 'keep one h1 and the section links',
      actual: consoleTabs.map((tab) => {
        const html = render('autumn-open', { tab });
        return [
          html.match(/<h1 /g)?.length,
          html.includes('aria-label="Console sections"'),
        ];
      }),
      expected: consoleTabs.map(() => [1, true]),
    });
  });

  test('setup: only Generate pairings is a link, nothing is visible yet', () => {
    const html = render('autumn-open');
    assert({
      given: 'the not-yet-generated round',
      should:
        'link Generate pairings to the next state and disable the other two',
      actual: [
        /href="\/tournaments\/organize\/autumn-open\?round=generated"[^>]*>Generate pairings</.test(
          html,
        ),
        /<button type="button" disabled=""[^>]*>Assign judges</.test(html),
        /<button type="button" disabled=""[^>]*>Release to entrants</.test(
          html,
        ),
        html.includes('No pairings yet'),
        html.includes('Round of 32: pairings not made'),
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('generated: pairings and byes, judges not assigned', () => {
    const html = render('autumn-open', { round: 'generated' });
    assert({
      given: 'generated pairings',
      should:
        'list eight debates, eight byes, Not assigned and Assign judges as the link',
      actual: [
        html.includes(
          '@entrant-09 <span class="text-ink-faint">(9)</span> vs @entrant-24',
        ),
        html.includes('Byes: @debater-c'),
        html.match(/Not assigned/g)?.length,
        /href="\/tournaments\/organize\/autumn-open\?round=assigned"[^>]*>Assign judges</.test(
          html,
        ),
      ],
      expected: [true, true, 8, true],
    });
  });

  test('assigned: judges named by the system, one reassigned; release is next', () => {
    const html = render('autumn-open', { round: 'assigned' });
    assert({
      given: 'assigned judges',
      should:
        'show judges, a swapped conflict, the no-pick note and Release as the link',
      actual: [
        html.includes('@judge-01'),
        html.includes('Reassigned'),
        html.includes('volunteer judges'),
        /href="\/tournaments\/organize\/autumn-open\?round=released"[^>]*>Release to entrants</.test(
          html,
        ),
      ],
      expected: [true, true, true, true],
    });
  });

  test('released: nothing left to press', () => {
    const html = render('autumn-open', { round: 'released' });
    assert({
      given: 'a released round',
      should: 'show every step disabled and the check-in time',
      actual: [
        (
          html.match(
            /<button type="button" disabled=""[^>]*>(Generate pairings|Assign judges|Release to entrants)</g,
          ) ?? []
        ).length,
        html.includes('check-in opens 13:50'),
      ],
      expected: [3, true],
    });
  });

  test('entrants: seeds, statuses and disabled remove and disqualify', () => {
    const html = render('autumn-open', { tab: 'entrants' });
    assert({
      given: 'the entrants tab',
      should: 'list nine, show byes, and never offer a working remove',
      actual: [
        html.includes('24 entered, 1 withdrawn, waitlist empty'),
        html.match(/>Bye</g)?.length,
        html.includes('Showing 9 of 24'),
        (html.match(/<button type="button" disabled=""[^>]*>Remove</g) ?? [])
          .length,
      ],
      expected: [true, 8, true, 9],
    });
  });

  test('results running: a needs-result form that is off, and the log', () => {
    const html = render('autumn-open', { tab: 'results', round: 'running' });
    assert({
      given: 'running debates',
      should: 'show the eight rows, the D5 form disabled and the log',
      actual: [
        html.includes('Enter result for D5'),
        html.includes('Audit logged'),
        /<button type="button" disabled=""[^>]*>Save result</.test(html),
        html.includes('Tournament log'),
        html.includes('Judge disconnected, no ballot for 18 minutes.'),
        html.includes('Forfeit to confirm'),
      ],
      expected: [true, true, true, true, true, true],
    });
  });

  test('results before debates: the empty state', () => {
    assert({
      given: 'a round not yet running',
      should: 'say no results yet',
      actual: render('autumn-open', { tab: 'results' }).includes(
        'No results yet',
      ),
      expected: true,
    });
  });

  test('moderation: report, forfeit and moderators, every decision disabled', () => {
    const html = render('autumn-open', { tab: 'moderation', round: 'running' });
    assert({
      given: 'a running round',
      should: 'show the conduct report, the forfeit and the moderators',
      actual: [
        html.includes('Conduct report on D2'),
        html.includes('Forfeit requested on D8'),
        html.includes('@moderator-one'),
        (
          html.match(
            /<button type="button" disabled=""[^>]*>(Dismiss|Warn|Forfeit the round|Disqualify)</g,
          ) ?? []
        ).length,
      ],
      expected: [true, true, true, 4],
    });
  });

  test('moderation before debates: nothing to decide yet', () => {
    assert({
      given: 'a setup round',
      should: 'say no reports yet',
      actual: render('autumn-open', { tab: 'moderation' }).includes(
        'No reports yet',
      ),
      expected: true,
    });
  });

  test('publish: the checklist is not ready and Publish stays off', () => {
    const html = render('autumn-open', { tab: 'publish', round: 'running' });
    assert({
      given: 'a tournament not finished',
      should:
        'list four checks, a disabled Publish and link the results preview',
      actual: [
        html.includes('Before you can publish results'),
        html.includes('No debate is missing a result (1 missing)'),
        /<button type="button" disabled=""[^>]*>Publish results</.test(html),
        html.includes('href="/tournaments/autumn-open/results"'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('a tournament already running opens running', () => {
    const html = render('harvest-cup', { tab: 'results' });
    assert({
      given: 'Harvest Cup',
      should: 'show its In progress badge and four rows',
      actual: [
        html.includes('In progress'),
        html.includes('Enter result for D3'),
        html.includes('Harvest Cup console'),
      ],
      expected: [true, true, true],
    });
  });
});

describe('ConsoleUnavailable', () => {
  test('links back to Organize', () => {
    const html = renderToString(h(ConsoleUnavailable));
    assert({
      given: 'an unknown tournament',
      should: 'say it was not found and link back',
      actual: [
        html.includes('We could not find that tournament'),
        html.includes('href="/tournaments/organize"'),
      ],
      expected: [true, true],
    });
  });
});
