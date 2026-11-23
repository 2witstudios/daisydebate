import { idle } from '../../../features/forms/form-state';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { WithAppRouter } from '../../test-support/app-router';
import {
  renderAccessible,
  type AccessibleView,
} from '../../../test-support/rendered/accessible';
import { CaptureChoice, CaptureSummary } from './capture-choice';

setupRitewayBun();

const action = async () => idle();
const render = (
  captureOffer: 'included' | 'premium' | null,
  capture: Parameters<typeof CaptureChoice>[0]['view']['capture'] = null,
) =>
  renderAccessible(
    <WithAppRouter>
      <CaptureChoice
        view={{ captureOffer, capture, version: 3 }}
        commandId="capture-id"
        action={action}
      />
    </WithAppRouter>,
  );

/** The named fields a submit button's form posts, with their values. */
const posted = (button: Element) =>
  Object.fromEntries(
    [
      ...((button as HTMLButtonElement).form?.querySelectorAll('[name]') ?? []),
    ].map((field) => [
      field.getAttribute('name'),
      (field as HTMLInputElement).value,
    ]),
  );

/**
 * The option a select shows on load (its `selected` attribute). The live
 * `selected` state is not read: happy-dom's selectedness can carry over
 * between renders into the one shared document.
 */
const selectedOn = (view: AccessibleView, select: string) =>
  view
    .within('combobox', select)
    .all('option')
    .filter((option) => option.hasAttribute('selected'))
    .map((option) => option.getAttribute('value'))
    .join();

/** Nothing rendered: no text and no control of any kind. */
const empty = (view: AccessibleView) =>
  view.textContent() === '' &&
  ['button', 'link', 'checkbox', 'switch', 'combobox', 'note'].every(
    (role) => view.count(role, undefined, { hidden: true }) === 0,
  );

describe('The capture choice', () => {
  test('no offer renders nothing', () => {
    assert({
      given: 'ranked, or anyone but the host',
      should: 'render nothing',
      actual: empty(render(null)),
      expected: true,
    });
  });

  test('a host with no grant sees the upgrade panel in place', () => {
    const view = render('premium');
    const switches = view.all('switch');
    assert({
      given: 'no entitlement',
      should:
        'show both switches disabled, the Premium panel and no form or named field',
      actual: [
        view.textContent().includes('Recording and broadcast are Premium'),
        view
          .all('link')
          .some((link) => link.getAttribute('href') === '/premium'),
        view.textContent().includes('Not now'),
        switches.filter((control) => control.hasAttribute('disabled')).length,
        // A form has no role until it is named: no submit button means no form posts.
        view.all('button').some((button) => (button as HTMLButtonElement).form),
        switches.some((control) => control.hasAttribute('name')),
      ],
      expected: [true, true, true, 2, false, false],
    });
  });

  test('a host who lost the entitlement can still turn capture off', () => {
    const view = render('premium', {
      broadcast: null,
      recordingPolicy: 'released',
    });
    const fields = posted(
      view.get('button', 'Turn off broadcast and recording'),
    );
    assert({
      given: 'capture set and no entitlement any more',
      should:
        'post a native set-capture form with no choices in it, to clear it',
      actual: [fields.type, 'broadcast' in fields, 'recording' in fields],
      expected: ['set-capture', false, false],
    });
  });

  test('an entitled host gets two separate choices in a native form', () => {
    const view = render('included');
    const fields = posted(view.get('button', 'Save broadcast and recording'));
    assert({
      given: 'the entitlement',
      should: 'post plain fields carrying the command envelope',
      actual: [
        view.attribute(
          'checkbox',
          'Broadcast this round to its audience',
          'name',
        ),
        view.attribute('checkbox', 'Record this round', 'name'),
        view.attribute('combobox', 'Release the broadcast', 'name'),
        view.attribute(
          'checkbox',
          'Debaters can read spectator chat during the round',
          'name',
        ),
        fields.type,
        fields.commandId,
      ],
      expected: [
        'broadcast',
        'recording',
        'release',
        'debatersReadChat',
        'set-capture',
        'capture-id',
      ],
    });
  });

  test('the stored choice fills the form', () => {
    const view = render('included', {
      broadcast: {
        release: { kind: 'delay', seconds: 300 },
        debatersReadChat: false,
      },
      recordingPolicy: 'released',
    });
    assert({
      given: 'a stored broadcast on a 5 minute delay, chat off, recorded',
      should: 'select the release and tick only what was chosen',
      actual: [
        selectedOn(view, 'Release the broadcast'),
        view.has('checkbox', 'Broadcast this round to its audience', {
          checked: true,
        }),
        view.has('checkbox', 'Record this round', { checked: true }),
        view.has(
          'checkbox',
          'Debaters can read spectator chat during the round',
          { checked: true },
        ),
      ],
      expected: ['delay:300', true, true, false],
    });
  });
});

describe('The summary before Ready', () => {
  test('it says what was chosen, and nothing when nothing was', () => {
    assert({
      given: 'a recording, then no choice',
      should: 'state it, then render nothing',
      actual: [
        renderAccessible(
          <CaptureSummary
            capture={{ broadcast: null, recordingPolicy: 'released' }}
          />,
        ).text('note'),
        empty(renderAccessible(<CaptureSummary capture={null} />)),
      ],
      expected: ['Not broadcast. Recorded.', true],
    });
  });
});

test('a locked capture offer has a native Premium destination', () => {
  assert({
    given: 'a subscription-locked casual capture offer',
    should: 'link to existing Premium terms',
    actual: render('premium')
      .all('link')
      .some((link) => link.getAttribute('href') === '/premium'),
    expected: true,
  });
});
