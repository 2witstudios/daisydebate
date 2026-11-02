import { sampleWatchSource } from '../../../features/watch/sample-source.test-support';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { mockNextRouter } from '../../../lib/testing/mock-router';
import { watchViewer } from '../../../features/watch/sample-source.test-support';
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
  const screen = openReplay(id, watchViewer(true), query, sampleWatchSource);
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

  test('sharing states who can replay, with no inert control', () => {
    assert({
      given: "someone else's public recording",
      should: 'show visibility and the link, and no manager or report control',
      actual: [
        html.includes('Share and visibility'),
        html.includes('Manage visibility'),
        html.includes('value="/recordings/semifinal-rehearsal"'),
        html.includes('Report'),
      ],
      expected: [true, false, true, false],
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
