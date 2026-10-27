import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  parseScoreBlocks,
  renderStatus,
  runProgressSync,
  type ProgressDeps,
} from './progress-canvas';

setupRitewayBun();

const block = (
  area: string,
  rows: Record<string, string>,
) => `<h3>Score: ${area}</h3>
<table>
<tr><th>Field</th><th>Value</th><th>Evidence</th></tr>
${Object.entries(rows)
  .map(
    ([field, value]) => `<tr><td>${field}</td><td>${value}</td><td>e</td></tr>`,
  )
  .join('\n')}
</table>`;

const rounds = {
  Category: 'Competition',
  Subtitle: 'live debate &amp; timing',
  Features: '80',
  Stable: '75',
  Hardened: '70',
  Scale: '45',
  Spec: '80',
  Status: 'Bot rounds proven on staging.',
};

describe('parseScoreBlocks', () => {
  test('reads every Score block on an area page', () => {
    const html = `<h1>Rooms and play</h1><p>Purpose.</p>
${block('Rounds', rounds)}
${block('Privacy policy &amp; terms', { ...rounds, Category: 'Business &amp; legal', Scale: 'n/a', Tag: 'at launch' })}`;
    assert({
      given:
        'a page with two Score blocks, one with an n/a dimension and a tag',
      should: 'return one area per block with decoded text and numbers',
      actual: parseScoreBlocks(html, { id: 'p1', title: 'Rooms and play' }),
      expected: [
        {
          name: 'Rounds',
          pageId: 'p1',
          category: 'Competition',
          subtitle: 'live debate & timing',
          scores: [80, 75, 70, 45, 80],
          status: 'Bot rounds proven on staging.',
          tag: undefined,
        },
        {
          name: 'Privacy policy & terms',
          pageId: 'p1',
          category: 'Business & legal',
          subtitle: 'live debate & timing',
          scores: [80, 75, 70, undefined, 80],
          status: 'Bot rounds proven on staging.',
          tag: 'at launch',
        },
      ],
    });
  });

  test('refuses a malformed block, naming the page and area', () => {
    const page = { id: 'p1', title: 'Rooms and play' };
    const message = (html: string) => {
      try {
        parseScoreBlocks(html, page);
        return 'no error';
      } catch (error) {
        return (error as Error).message;
      }
    };
    assert({
      given: 'a score above 100, a missing dimension and an unknown category',
      should: 'throw a message naming the page, the area and the problem',
      actual: [
        message(block('Rounds', { ...rounds, Spec: '120' })),
        message(block('Rounds', { ...rounds, Scale: '' })),
        message(block('Rounds', { ...rounds, Category: 'Misc' })),
      ],
      expected: [
        'Rooms and play (p1), Score: Rounds: Spec must be 0-100 or n/a, not "120"',
        'Rooms and play (p1), Score: Rounds: Scale must be 0-100 or n/a, not ""',
        'Rooms and play (p1), Score: Rounds: unknown Category "Misc"',
      ],
    });
  });

  test('ignores pages without a Score block', () => {
    assert({
      given: 'an index page',
      should: 'return no areas',
      actual: parseScoreBlocks('<h1>Product map</h1>', { id: 'x', title: 'x' }),
      expected: [],
    });
  });
});

describe('renderStatus', () => {
  const area = (name: string, category: string, scores: number[]) => ({
    name,
    pageId: name.toLowerCase(),
    category,
    subtitle: 's',
    scores,
    status: `${name} <note>`,
    tag: undefined,
  });
  const html = renderStatus(
    [
      area('Rounds', 'Competition', [80, 70, 70, 40, 80]),
      area('Premium', 'Business & legal', [20, 25, 40, 20, 45]),
    ],
    [{ number: 472, title: 'feat(formats): picker', isDraft: true }],
  );

  test('scores each area as the mean of its dimensions and the product as the mean of areas', () => {
    assert({
      given: 'two areas averaging 68 and 30',
      should: 'render their overall bars and a whole-product bar of 49',
      actual: [
        html.includes(
          '<div class="bar hi"><i style="width:68%"></i><span>68%</span></div>',
        ),
        html.includes(
          '<div class="bar lo"><i style="width:30%"></i><span>30%</span></div>',
        ),
        html.includes(
          'Whole product<small>average of 2 areas</small></td><td><div class="bar mid"><i style="width:49%"></i><span>49%</span></div>',
        ),
      ],
      expected: [true, true, true],
    });
  });

  test('links each area to its page, escapes text and lists the open PRs', () => {
    assert({
      given: 'an area note with markup and one open draft PR',
      should: 'link the area, escape the note and show the PR in Now',
      actual: [
        html.includes(
          '<a href="https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/rounds">Rounds</a>',
        ),
        html.includes('Rounds &lt;note&gt;'),
        html.includes('<h2>Now</h2>'),
        html.includes(
          '<a href="https://github.com/2witstudios/daisydebate/pull/472">#472</a>',
        ),
        html.includes('feat(formats): picker'),
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('renders an n/a dimension without a bar and leaves it out of the mean', () => {
    const one = renderStatus(
      [
        {
          ...area('Terms', 'Business & legal', [20, 20, 50, 0, 45]),
          scores: [20, 20, 50, undefined, 45],
        },
      ],
      [],
    );
    assert({
      given: 'an area whose Scale is n/a',
      should: 'show n/a and average the other four',
      actual: [one.includes('>n/a<'), one.includes('<span>34%</span>')],
      expected: [true, true],
    });
  });
});

const CANVAS = 'qndsohpp7nihje7a2dw3a2kl';

function fakes(current: string) {
  const writes: string[][] = [];
  const output: string[] = [];
  const deps: ProgressDeps = {
    areaPages: () => [
      { id: 'p1', title: 'Rooms and play', content: block('Rounds', rounds) },
    ],
    openPrs: () => [],
    canvas: () => current,
    write: (before, after) => void writes.push([before, after]),
    out: (text) => void output.push(text),
  };
  return { deps, writes, output };
}

describe('runProgressSync', () => {
  const rendered = renderStatus(
    parseScoreBlocks(block('Rounds', rounds), { id: 'p1', title: 'x' }),
    [],
  );

  test('reports in sync and writes nothing when the canvas matches', () => {
    const { deps, writes, output } = fakes(rendered);
    assert({
      given: `a canvas ${CANVAS} equal to the rendered area pages`,
      should: 'exit 0, say in sync and never write',
      actual: [runProgressSync(deps, true), output.join(''), writes.length],
      expected: [0, 'Project Status in sync with 1 areas\n', 0],
    });
  });

  test('reports drift without writing unless --apply', () => {
    const dry = fakes('<p>old</p>');
    const applied = fakes('<p>old</p>');
    assert({
      given: 'a stale canvas',
      should: 'exit 1 on a dry run and write the render on --apply',
      actual: [
        runProgressSync(dry.deps, false),
        dry.writes.length,
        runProgressSync(applied.deps, true),
        applied.writes,
      ],
      expected: [1, 0, 0, [['<p>old</p>', rendered]]],
    });
  });
});
