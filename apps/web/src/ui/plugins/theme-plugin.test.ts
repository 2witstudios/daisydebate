import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { themePlugin } from './theme-plugin';
import { createInitialState } from '../store/state';

setupRitewayBun();

const { setThemeColor } = themePlugin.transactions;

describe('themePlugin.setThemeColor', () => {
  test('switches the theme without mutating the previous snapshot', () => {
    const state = createInitialState();
    const light = setThemeColor(state, 'light');
    const dark = setThemeColor(light, 'dark');
    assert({
      given: 'a dark state toggled to light and back',
      should: 'produce new snapshots and leave each earlier one unchanged',
      actual: [
        state.resources.themeColor,
        light.resources.themeColor,
        dark.resources.themeColor,
        light === state,
      ],
      expected: ['dark', 'light', 'dark', false],
    });
  });

  test('touches only the theme resource', () => {
    const state = createInitialState();
    const next = setThemeColor(state, 'light');
    assert({
      given: 'a theme transition',
      should: 'preserve collections by reference and every other resource',
      actual: [
        next.collections === state.collections,
        { ...next.resources, themeColor: state.resources.themeColor },
      ],
      expected: [true, { ...state.resources }],
    });
  });
});
