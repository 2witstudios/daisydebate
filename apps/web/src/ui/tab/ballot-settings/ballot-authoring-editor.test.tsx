import { idle } from '../../../features/forms/form-state';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { EventBallotAuthoringView } from '@daisy/protocol/lobby/ballot-read';
import {
  authoringView,
  leagueBallotV3,
  leagueDefinitionId,
} from '../../../features/tab/ballot-preview-source.test-support';
import { WithAppRouter } from '../../test-support/app-router';
import { BallotAuthoringEditor } from './ballot-authoring-editor';

setupRitewayBun();

const action = async () => idle();

const render = (view: EventBallotAuthoringView) =>
  renderToString(
    h(
      WithAppRouter,
      null,
      h(BallotAuthoringEditor, {
        view,
        saved: null,
        publish: action,
        pin: action,
        screening: action,
      }),
    ),
  );

/** The preview section's markup, which ends before the settings column. */
const previewOf = (html: string) => {
  const start = html.indexOf('aria-label="Preview of the judge&#x27;s ballot"');
  const column = html.indexOf('w-host-aside');
  return { start, column, markup: html.slice(start, column) };
};

describe('BallotAuthoringEditor', () => {
  test('the ballot leads and the settings follow', () => {
    const html = render(authoringView());
    const { start, column, markup } = previewOf(html);
    const forms = [...html.matchAll(/<form/g)].map((match) => match.index);
    assert({
      given: "a stored event's ballot",
      should:
        "draw the header, then the judge's ballot as the main column, then every settings form in the right column",
      actual: [
        html.indexOf('<h1') < start,
        start !== -1 && start < column,
        markup.includes('<form'),
        forms.length,
        forms.every((index) => index > column),
        /<div class="[^"]*\bw-host-aside\b[^"]*max-rail:w-full/.test(html),
        /<div class="flex items-start gap-6 max-rail:flex-col">/.test(html),
      ],
      expected: [true, true, false, 3, true, true, true],
    });
  });

  test("the preview is the event's saved definition", () => {
    const { markup } = previewOf(render(authoringView()));
    assert({
      given:
        'version 2: a winner ballot scored 20 to 30 in halves, a double loss allowed, a required reason, no feedback',
      should:
        'draw that ballot with the sample names, labelled as the saved version',
      actual: [
        markup.includes('The saved ballot, version 2.'),
        markup.includes('Jensen') && markup.includes('Doyle'),
        markup.includes('A loss for both'),
        /type="range"[^>]*min="20" max="30" step="0.5"/.test(markup),
        markup.includes('Reason for decision'),
        markup.includes('Feedback for'),
        /<fieldset disabled=""/.test(markup),
      ],
      expected: [true, true, true, true, true, false, true],
    });
  });

  test('a ranking definition', () => {
    const { markup } = previewOf(
      render(
        authoringView({
          definition: {
            source: { kind: 'stored', id: leagueDefinitionId, version: 3 },
            ballot: leagueBallotV3,
          },
        }),
      ),
    );
    assert({
      given: 'a saved ranking of sides with no scores or written fields',
      should: 'draw the places and nothing to score or write',
      actual: [
        markup.includes('Who placed where?'),
        markup.includes('type="range"'),
        markup.includes('Reason for decision'),
        markup.includes('The saved ballot, version 3.'),
      ],
      expected: [true, false, false, true],
    });
  });

  test('a format with no ballot', () => {
    const { markup } = previewOf(
      render(authoringView({ definition: null, sourceName: null })),
    );
    assert({
      given: 'no ballot definition',
      should: 'say a judge is given no ballot',
      actual: markup.includes(
        'This format has no ballot, so a judge is given none.',
      ),
      expected: true,
    });
  });
});
