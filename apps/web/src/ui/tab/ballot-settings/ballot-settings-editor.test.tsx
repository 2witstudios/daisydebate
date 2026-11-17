import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { initialFormState } from '../../../features/forms/form-state';
import { readBallotSettings } from '../../../features/tab/sample/read-ballot-definition';
import { WithAppRouter } from '../../test-support/app-router';
import { BallotSettingsEditor } from './ballot-settings-editor';

setupRitewayBun();

const settings = readBallotSettings('autumn-open', 'varsity-debate', {
  viewer: 'host',
  moment: 'prelims',
  scale: 'normal',
});

const render = () =>
  settings === null
    ? ''
    : renderToString(
        h(
          WithAppRouter,
          null,
          h(BallotSettingsEditor, {
            settings,
            submit: async () => initialFormState,
            header: h('a', { href: '/setup' }, 'Setup'),
          }),
        ),
      );

describe('BallotSettingsEditor', () => {
  test('the ballot leads and the settings follow', () => {
    const html = render();
    const preview = html.indexOf(
      'aria-label="Preview of the judge&#x27;s ballot"',
    );
    const form = html.indexOf('<form');
    const formEnd = html.indexOf('</form>');
    const formId = /<form[^>]* id="([^"]+)"/.exec(html)?.[1];
    assert({
      given: "an event's ballot settings",
      should:
        'draw the header, then the judge ballot as the main column, then the settings form, with the header Save posting that form by its id and a narrow-only Save inside it',
      actual: [
        html.indexOf('>Setup<') < html.indexOf('<h1'),
        html.indexOf('<h1') < preview,
        preview !== -1 && preview < form,
        html.indexOf('What a judge sees') < form,
        html.slice(form, formEnd).includes('What a judge sees'),
        html.slice(form, formEnd).includes('name="screening"'),
        formId !== undefined &&
          (html.slice(0, form).match(/<button[^>]*>/g) ?? []).some(
            (tag) =>
              tag.includes('type="submit"') && tag.includes(`form="${formId}"`),
          ),
        html
          .slice(form, formEnd)
          .includes('<div class="hidden max-rail:block"><button type="submit"'),
      ],
      expected: [true, true, true, true, false, true, true, true],
    });
  });

  test('the settings sit in the right-hand column', () => {
    const html = render();
    const form = /<form[^>]*class="([^"]*)"/.exec(html)?.[1] ?? '';
    const preview =
      /<section aria-label="Preview of the judge&#x27;s ballot" class="([^"]*)"/.exec(
        html,
      )?.[1] ?? '';
    assert({
      given: 'the two columns',
      should:
        'give the ballot the flexible width and the settings the fixed side column, stacking below the rail breakpoint',
      actual: [
        preview.includes('flex-1'),
        form.includes('w-host-aside'),
        form.includes('max-rail:w-full'),
      ],
      expected: [true, true, true],
    });
  });
});
