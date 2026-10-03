import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { mockNextRouter } from '../../../lib/testing/mock-router';
import { initialMockForm } from '../../../features/mock-form/form';
import { applyAction, presetFor } from '../../../features/rooms/state';
import { roomView, type RoomInfo } from '../../../features/rooms/view';

setupRitewayBun();

// The settings form reads the Next router, which only exists in a running app.
await mockNextRouter();
const { RoomPage } = await import('./room-page');

const info: RoomInfo = {
  id: 'demo',
  title: 'Newcomers welcome',
  mode: 'practice',
  hostHandle: 'host-two',
  judge: 'person',
};

const settingsAction = async () => initialMockForm;
const render = (state: ReturnType<typeof presetFor>) =>
  renderToString(h(RoomPage, { view: roomView(info, state), settingsAction }));

describe('RoomPage', () => {
  test('a fresh room, as its host', () => {
    const html = render(presetFor('created'));
    assert({
      given: 'a room the viewer just created',
      should:
        'show three open seats, the host controls and the demo controls, with no ready or start control',
      actual: [
        html.match(/<h1 /g)?.length,
        (html.match(/Open seat/g) ?? []).length,
        html.includes('Who judges'),
        html.includes('Close room'),
        html.includes('Demo controls'),
        html.includes('Are you ready?'),
        html.includes('Start the debate'),
      ],
      expected: [1, 3, true, true, true, false, false],
    });
  });

  test('the AI judge is labelled a placeholder', () => {
    const html = render(presetFor('ai-judge'));
    assert({
      given: 'a room judged by the placeholder AI judge',
      should: 'say it rules at random and offers no seat to take for the judge',
      actual: [
        html.includes('Placeholder AI judge'),
        html.includes('Rules at random'),
        html.includes('>AI<'),
      ],
      expected: [true, true, true],
    });
  });

  test('a seated, unready viewer', () => {
    const state = applyAction(presetFor('ai-judge'), {
      kind: 'take',
      seat: 'negative',
    });
    const html = render(state);
    assert({
      given: 'a viewer in a seat of a room that is not ready',
      should:
        'offer the ready control and a start button that is off with its reason',
      actual: [
        html.includes('Are you ready?'),
        html.includes('Start the debate'),
        /<button [^>]*disabled=""[^>]*>Start debate/.test(html),
        html.includes('Everyone seated must be ready.'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('ready status unavailable', () => {
    const state = applyAction(
      applyAction(presetFor('ai-judge'), { kind: 'take', seat: 'negative' }),
      { kind: 'demo', what: 'redis-down' },
    );
    const html = render(state);
    assert({
      given: 'a seated viewer while ready status is down',
      should: 'say it is unavailable and turn the ready control off',
      actual: [
        html.includes('Ready status unavailable'),
        /<button [^>]*disabled=""[^>]*>I am ready/.test(html),
        html.includes('Ready status is unavailable right now.'),
      ],
      expected: [true, true, true],
    });
  });

  test('a started room', () => {
    const html = render(presetFor('started'));
    assert({
      given: 'a started room',
      should: 'link to the debate',
      actual: [
        html.includes('The debate has started'),
        html.includes('href="/debates/demo?kind=person"'),
      ],
      expected: [true, true],
    });
  });

  test('a closed room', () => {
    const html = render(presetFor('closed'));
    assert({
      given: 'a closed room',
      should: 'say it is closed and offer nothing to do',
      actual: [
        html.includes('This room is closed'),
        html.includes('Take seat'),
        html.includes('Start debate'),
      ],
      expected: [true, false, false],
    });
  });

  test('a room the viewer cannot see', () => {
    const html = render(presetFor('private'));
    assert({
      given: 'a private room and an outsider',
      should: 'say so, name nothing about the room and offer the lobby',
      actual: [
        html.includes('You cannot see this room'),
        html.includes('Newcomers welcome'),
        html.includes('href="/lobby"'),
      ],
      expected: [true, false, true],
    });
  });
});
