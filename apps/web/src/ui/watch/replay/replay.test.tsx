import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { mockNextRouter } from '../../../lib/testing/mock-router';
import { watchViewer } from '../../../features/watch/debate-source';
import { openReplay } from '../../../features/watch/open-replay';
import {
  defaultReplayQuery,
  type ReplayQuery,
} from '../../../features/watch/replay-query';

setupRitewayBun();

// The play toggle reads the Next router, which only exists in a running app.
await mockNextRouter();
const { Replay } = await import('./replay');

const render = (id: string, query: ReplayQuery = defaultReplayQuery) => {
  const screen = openReplay(id, watchViewer(true), query);
  if (screen.kind !== 'watch') throw new Error('not watchable');
  return renderToString(h(Replay, { view: screen.view }));
};

describe('Replay: a published result', () => {
  const html = render('semifinal-rehearsal');

  test('player, timeline and transcript', () => {
    assert({
      given: 'the default position',
      should:
        'show the turn playing, step links, phase jumps and the transcript',
      actual: [
        html.includes('Semifinal rehearsal'),
        html.includes('Turn 5 of 12'),
        html.includes('11:30 / 30:00'),
        html.includes('href="/recordings/semifinal-rehearsal?t=750"'),
        html.includes('aria-label="Jump to Speech [4]"'),
        html.includes('aria-label="Turns"'),
        html.includes('aria-current="true"'),
        html.includes('href="/recordings"'),
      ],
      expected: [true, true, true, true, true, true, true, true],
    });
  });

  test('every control works without script', () => {
    assert({
      given: 'the server render',
      should:
        'have a GET position form, a GET transcript form and a disabled Play',
      actual: [
        (html.match(/method="get"/g) ?? []).length,
        html.includes('type="range"'),
        html.includes('name="speed"'),
        html.includes('aria-label="Jump to a phase"'),
        /<button [^>]*disabled=""[^>]*aria-label="Play"|aria-label="Play"[^>]*disabled=""/.test(
          html,
        ),
      ],
      expected: [2, true, true, true, true],
    });
  });

  test('result and judges', () => {
    assert({
      given: 'a ranked result',
      should: 'show the headline, rating changes and judges',
      actual: [
        html.includes('Neg wins, 2 to 1'),
        html.includes('1655 to 1646'),
        html.includes('-9'),
        html.includes('+9'),
        (html.match(/>Judge \d</g) ?? []).length,
      ],
      expected: [true, true, true, true, 3],
    });
  });

  test('a recording that is not mine has no manager', () => {
    assert({
      given: "someone else's public recording",
      should:
        'show visibility and the link, but no Manage control, and a Report that answers as a sample action',
      actual: [
        html.includes('Share and visibility'),
        html.includes('Manage visibility'),
        html.includes('value="/recordings/semifinal-rehearsal"'),
        html.includes('href="?did=Send+report"'),
      ],
      expected: [true, false, true, true],
    });
  });
});

describe('Replay: the visibility manager', () => {
  test('offered to the people seated', () => {
    const html = render('fast-rounds');
    assert({
      given: 'my unlisted ranked recording',
      should: 'offer Manage visibility as a link that opens the manager',
      actual: [
        /<a [^>]*href="\/recordings\/fast-rounds\?pane=share&amp;manage=1"[^>]*>Manage visibility/.test(
          html,
        ),
        html.includes('Unlisted'),
      ],
      expected: [true, true],
    });
  });

  test('open, with a draft', () => {
    const html = render('fast-rounds', {
      ...defaultReplayQuery,
      manage: true,
      vis: 'public',
      pane: 'share',
    });
    assert({
      given: 'the manager open with Public chosen',
      should:
        'show three radios (Private locked for ranked), a GET form, a Save that answers as a sample action and a Close link',
      actual: [
        (html.match(/type="radio"/g) ?? []).length,
        /value="private"[^>]*disabled=""|disabled=""[^>]*value="private"/.test(
          html,
        ),
        /value="public"[^>]*checked=""|checked=""[^>]*value="public"/.test(
          html,
        ),
        html.includes('href="?did=Save+visibility"'),
        />Use this choice</.test(html),
        />Close</.test(html),
        html.includes('Not for ranked debates'),
        html.includes('ends anyone watching'),
      ],
      expected: [3, true, true, true, true, true, true, true],
    });
  });

  test('a casual private recording allows Private', () => {
    const html = render('practice-with-a-friend', {
      ...defaultReplayQuery,
      manage: true,
    });
    assert({
      given: 'my private casual recording',
      should: 'keep Private checked and not locked',
      actual: [
        /value="private"[^>]*checked=""|checked=""[^>]*value="private"/.test(
          html,
        ),
        /value="private"[^>]*disabled=""|disabled=""[^>]*value="private"/.test(
          html,
        ),
      ],
      expected: [true, false],
    });
  });
});

describe('Replay: other states', () => {
  test('ballots pending', () => {
    const html = render('evening-round');
    assert({
      given: 'a recording with 2 of 3 ballots in',
      should: 'show the pending result and no judge reasons',
      actual: [
        html.includes('Result pending'),
        html.includes('2 of 3 ballots are in'),
        html.includes('>Judge 1<'),
      ],
      expected: [true, true, false],
    });
  });

  test('a search with no match', () => {
    const html = render('semifinal-rehearsal', {
      ...defaultReplayQuery,
      q: 'zzz',
    });
    assert({
      given: 'a transcript search matching nothing',
      should: 'say so and offer Clear search',
      actual: [
        html.includes('Nothing in this transcript matches.'),
        html.includes('Clear search'),
      ],
      expected: [true, true],
    });
  });

  test('phone panes come from the URL', () => {
    const result = render('semifinal-rehearsal', {
      ...defaultReplayQuery,
      pane: 'result',
    });
    assert({
      given: 'the result pane selected',
      should:
        'mark the Result tab current and hide the other panes on the phone',
      actual: [
        /aria-current="page"[^>]*>Result/.test(result),
        result.includes('max-compact:hidden'),
        html().includes('href="/recordings/semifinal-rehearsal?pane=share"'),
      ],
      expected: [true, true, true],
    });
  });
});

const html = () => render('semifinal-rehearsal');
