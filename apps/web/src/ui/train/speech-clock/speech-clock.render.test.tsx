import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { findElements } from '../../test-support/find-elements';
import {
  renderSpeechClock,
  type SpeechClockViewProps,
} from './speech-clock.render';

setupRitewayBun();

const base: SpeechClockViewProps = {
  display: '4:18',
  lengthLabel: '5:00',
  percent: 14,
  paused: false,
  timeUp: false,
  live: true,
  actions: 'ACTIONS',
  endHref: 'END',
  onPause: () => {},
  onResume: () => {},
};

const html = (over: Partial<SpeechClockViewProps> = {}) =>
  renderToString(<>{renderSpeechClock({ ...base, ...over })}</>);

describe('renderSpeechClock', () => {
  test('the timer is named and shows the time and length', () => {
    const out = html();
    assert({
      given: 'a running clock at 4:18 of 5:00',
      should: 'expose a named timer, the length, the meter and the actions',
      actual: [
        out.includes('role="timer"'),
        out.includes('aria-label="Time left in this speech"'),
        out.includes('4:18'),
        out.includes('of 5:00'),
        out.includes('aria-valuenow="14"'),
        out.includes('ACTIONS'),
        out.includes('role="dialog"'),
      ],
      expected: [true, true, true, true, true, true, false],
    });
  });

  test('Pause waits for the page to be live', () => {
    assert({
      given: 'a clock before hydration, and after',
      should: 'disable Pause only before',
      actual: [
        html({ live: false }).includes('disabled=""'),
        html({ live: true }).includes('disabled=""'),
      ],
      expected: [true, false],
    });
  });

  test('time up is announced', () => {
    assert({
      given: 'a finished clock',
      should: 'say time is up in a polite live region',
      actual: [
        html({ timeUp: true }).includes('Time is up'),
        html().includes('Time is up'),
        html().includes('aria-live="polite"'),
      ],
      expected: [true, false, true],
    });
  });

  test('paused: a dialog', () => {
    const out = html({ paused: true });
    assert({
      given: 'a paused clock',
      should: 'open the Paused dialog with Resume',
      actual: [
        out.includes('role="dialog"'),
        out.includes('aria-label="Paused"'),
        out.includes('Resume'),
        out.includes('END'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('Pause and Resume call back', () => {
    const calls: string[] = [];
    const tree = renderSpeechClock({
      ...base,
      paused: true,
      onPause: () => calls.push('pause'),
      onResume: () => calls.push('resume'),
    });
    const buttons = findElements(tree, (element) => element.type === 'button');
    for (const button of buttons) {
      const onClick = button.props['onClick'];
      if (typeof onClick === 'function') onClick();
    }
    assert({
      given: 'the Pause button and the dialog Resume button clicked',
      should: 'call pause then resume',
      actual: calls,
      expected: ['pause', 'resume'],
    });
  });
});
