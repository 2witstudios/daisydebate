import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { WithAppRouter } from '../../test-support/app-router';
import {
  CaptureChoice,
  CaptureSummary,
  capturePremiumText,
} from './capture-choice';

setupRitewayBun();

const action = async () => ({ values: {} });
const render = (
  captureOffer: 'included' | 'premium' | null,
  capture: Parameters<typeof CaptureChoice>[0]['view']['capture'] = null,
) =>
  renderToStaticMarkup(
    <WithAppRouter>
      <CaptureChoice
        view={{ captureOffer, capture, version: 3 }}
        commandId="capture-id"
        action={action}
      />
    </WithAppRouter>,
  );

describe('The capture choice', () => {
  test('no offer renders nothing', () => {
    assert({
      given: 'ranked, or anyone but the host',
      should: 'render nothing',
      actual: render(null),
      expected: '',
    });
  });

  test('a host with no grant is offered neither', () => {
    const html = render('premium');
    assert({
      given: 'no entitlement',
      should: 'say so and offer no control at all',
      actual: [
        html.includes(capturePremiumText.replaceAll("'", '&#x27;')),
        html.includes('<input'),
        html.includes('<form'),
      ],
      expected: [true, false, false],
    });
  });

  test('a host who lost the entitlement can still turn capture off', () => {
    const html = render('premium', {
      broadcast: null,
      recording: true,
    });
    assert({
      given: 'capture set and no entitlement any more',
      should:
        'post a native set-capture form with no choices in it, to clear it',
      actual: [
        html.includes('<form'),
        html.includes('value="set-capture"'),
        html.includes('Turn off'),
        html.includes('name="broadcast"'),
        html.includes('name="recording"'),
      ],
      expected: [true, true, true, false, false],
    });
  });

  test('an entitled host gets two separate choices in a native form', () => {
    const html = render('included');
    assert({
      given: 'the entitlement',
      should: 'post plain fields carrying the command envelope',
      actual: [
        'name="broadcast"',
        'name="recording"',
        'name="release"',
        'name="debatersReadChat"',
        'value="set-capture"',
        'value="capture-id"',
      ].map((field) => html.includes(field)),
      expected: Array(6).fill(true),
    });
  });

  test('the stored choice fills the form', () => {
    const html = render('included', {
      broadcast: {
        release: { kind: 'delay', seconds: 300 },
        debatersReadChat: false,
      },
      recording: true,
    });
    assert({
      given: 'a stored broadcast on a 5 minute delay, chat off, recorded',
      should: 'select the release and tick only what was chosen',
      actual: [
        /<option value="delay:300" selected/.test(html),
        /name="broadcast" checked/.test(html),
        /name="recording" checked/.test(html),
        /name="debatersReadChat" checked/.test(html),
      ],
      expected: [true, true, true, false],
    });
  });
});

describe('The summary before Ready', () => {
  test('it says what was chosen, and nothing when nothing was', () => {
    assert({
      given: 'a recording, then no choice',
      should: 'state it, then render nothing',
      actual: [
        renderToStaticMarkup(
          <CaptureSummary capture={{ broadcast: null, recording: true }} />,
        ).includes('Not broadcast. Recorded.'),
        renderToStaticMarkup(<CaptureSummary capture={null} />),
      ],
      expected: [true, ''],
    });
  });
});
