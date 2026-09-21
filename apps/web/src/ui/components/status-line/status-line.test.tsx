import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { StatusLine } from './status-line';
import { Stat } from '../stat/stat';
import { IconButton } from '../icon-button/icon-button';
import { PresenceDot } from '../presence-dot/presence-dot';

setupRitewayBun();

describe('StatusLine', () => {
  test('pairs a tone dot with the count text', () => {
    const html = renderToString(
      h(StatusLine, { tone: 'online', children: '1,248 online' }),
    );
    assert({
      given: 'an online status line',
      should: 'render the count text',
      actual: html.includes('1,248 online'),
      expected: true,
    });
  });
});

describe('Stat', () => {
  test('pairs an icon with the value', () => {
    const html = renderToString(
      h(Stat, { icon: 'chart', value: '1820', label: 'rating' }),
    );
    assert({
      given: 'a stat with icon, value, and label',
      should: 'render all three parts',
      actual: [html.includes('1820'), html.includes('rating')],
      expected: [true, true],
    });
  });
});

describe('IconButton', () => {
  test('requires an accessible label', () => {
    const html = renderToString(
      h(IconButton, { name: 'bell', label: 'Notifications' }),
    );
    assert({
      given: 'an icon button',
      should: 'carry the accessible name',
      actual: html.includes('aria-label="Notifications"'),
      expected: true,
    });
  });
});

describe('PresenceDot', () => {
  test('announces the presence state', () => {
    const html = renderToString(h(PresenceDot, { presence: 'in-debate' }));
    assert({
      given: 'a presence dot',
      should: 'announce the presence as a status',
      actual: [html.includes('role="status"'), html.includes('in-debate')],
      expected: [true, true],
    });
  });
});
