import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  debriefView,
  defaultDebriefQuery,
  type DebriefQuery,
} from '../../../features/train/debrief';
import { defaultConfig } from '../../../features/train/practice';
import { defaultHubQuery } from '../../../features/train/query';
import { Debrief } from './debrief';

setupRitewayBun();

const render = (query: DebriefQuery = defaultDebriefQuery) =>
  renderToString(
    h(Debrief, {
      view: debriefView(defaultConfig, 'aff', query),
      config: defaultConfig,
      plan: defaultHubQuery,
      query,
    }),
  );

describe('Debrief', () => {
  test('a full debrief', () => {
    const html = render();
    assert({
      given: 'a finished practice',
      should: 'show stats, speeches, notes, work, saving and feedback',
      actual: [
        html.match(/<h1/g)?.length,
        html.includes('Practice · Unrated'),
        html.includes('Rating unchanged'),
        html.includes('3 of 4'),
        html.includes('4 of 5'),
        html.includes('96%'),
        html.includes('Turn 3: your Aff speech'),
        html.includes('Automated notes'),
        html.includes('Try next time.'),
        html.includes('Work on next'),
        html.includes('Save arguments to review'),
        html.includes('How was this session?'),
        html.includes('href="/train/practice"'),
        html.includes('Practice again'),
      ],
      expected: Array(14)
        .fill(true)
        .map((_, i) => (i === 0 ? 1 : true)),
    });
  });

  test('speeches are links and the open one is current', () => {
    const html = render({ ...defaultDebriefQuery, speech: 1 });
    assert({
      given: 'the second speech open',
      should: 'mark it current and link the others with their index',
      actual: [
        html.match(/aria-current="true"/g)?.length,
        html.includes('href="/train/practice/debrief?speech=2"'),
        html.includes('>Turn 3: your Aff speech</h2>'),
      ],
      expected: [1, true, true],
    });
  });

  test('saving is a GET form with checkboxes and a save button', () => {
    const html = render();
    assert({
      given: 'nothing saved',
      should: 'post the chosen arguments as saved= through a GET form',
      actual: [
        html.includes('method="get"'),
        html.includes('action="/train/practice/debrief"'),
        html.match(/name="saved"/g)?.length,
        /<button[^>]*name="save"/.test(html),
        html.match(
          /type="checkbox"[^>]*checked=""|checked=""[^>]*type="checkbox"/g,
        )?.length,
      ],
      expected: [true, true, 3, true, 2],
    });
  });

  test('saved and saving with nothing chosen', () => {
    const saved = render({ ...defaultDebriefQuery, saved: ['a0', 'a1'] });
    const empty = render({ ...defaultDebriefQuery, saveAttempted: true });
    assert({
      given: 'two saved, and a save pressed with none',
      should: 'confirm the first review, and ask for a choice in the second',
      actual: [
        saved.includes('Saved 2. The first review is tomorrow.'),
        saved.includes('name="save"'),
        empty.includes('Choose at least one argument to save.'),
      ],
      expected: [true, false, true],
    });
  });

  test('feedback keeps free text out of the URL', () => {
    const html = render();
    const sent = render({ ...defaultDebriefQuery, feedbackSent: true });
    assert({
      given: 'the feedback form and after sending',
      should: 'leave the textarea unnamed, then thank without the form',
      actual: [
        /<textarea[^>]*name=/.test(html),
        /<button[^>]*name="sent"/.test(html),
        sent.includes(
          'Thanks. Your feedback was sent without your speech text.',
        ),
        /<button[^>]*name="sent"/.test(sent),
      ],
      expected: [false, true, true, false],
    });
  });

  test('ended before any speech', () => {
    const query = { ...defaultDebriefQuery, upto: 1 };
    const html = renderToString(
      h(Debrief, {
        view: debriefView(defaultConfig, 'aff', query),
        config: defaultConfig,
        plan: defaultHubQuery,
        query,
      }),
    );
    assert({
      given: 'a debate ended on turn 1',
      should: 'say nothing was reviewed and offer only practice again and back',
      actual: [
        html.includes('No speeches yet'),
        html.includes('Automated notes'),
        html.includes('Save arguments to review'),
        html.includes('Practice again'),
        html.includes('href="/train/progress"'),
      ],
      expected: [true, false, false, true, true],
    });
  });

  test('Back to Train counts a practice that gave a speech', () => {
    assert({
      given: 'a finished practice on the default plan',
      should: 'return to a hub with guided practice done',
      actual: render().includes('href="/train/progress?did=guided-practice"'),
      expected: true,
    });
  });
});
