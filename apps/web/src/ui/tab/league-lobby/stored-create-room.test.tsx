import { renderToString } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { plainRoomConfig } from '@daisy/protocol/testing';
import type { StandingRoomView } from '../../../features/tab/standing-room-view';
import { StoredCreateRoom } from './stored-create-room';
setupRitewayBun();
const noop = () => {};
const router = {
  bfcacheId: 'test',
  back: noop,
  forward: noop,
  refresh: noop,
  push: noop,
  replace: noop,
  prefetch: noop,
};
const view: StandingRoomView = {
  leagueHandle: 'standing-address',
  lobby: { handle: 'standing-address', name: 'League' },
  templateId: 'template',
  templates: [],
  locked: [],
  defaults: [],
  creation: {
    selection: {
      kind: 'catalog',
      formatId: 'freestyle',
      formatVersion: 1,
      presetVersion: 1,
      competitionType: 'casual',
    },
    config: plainRoomConfig,
    visibility: { value: 'public', locked: false },
    recording: { value: 'on', locked: true },
    rating: { kind: 'unrated' },
    resolutionChoicePolicy: { method: 'fixed', ownText: true, choices: [] },
  },
};
const render = (input: StandingRoomView) =>
  renderToString(
    <AppRouterContext value={router}>
      <StoredCreateRoom view={input} action={async (state) => state} />
    </AppRouterContext>,
  );
test('native Room form displays actual recording enforcement and defaults', () => {
  const locked = render(view);
  const editable = render({
    ...view,
    creation: { ...view.creation, recording: { value: 'off', locked: false } },
  });
  assert({
    given: 'recording enforced on',
    should: 'display the actual lock and post on without an editable selector',
    actual: [
      locked.includes('name="recording" value="on"'),
      locked.includes('On · officials'),
      locked.includes('<select name="recording"'),
    ],
    expected: [true, true, false],
  });
  assert({
    given: 'recording defaults off without enforcement',
    should: 'prefill an editable off choice',
    actual: [
      editable.includes('<select name="recording"'),
      editable.includes('value="off" selected=""'),
    ],
    expected: [true, true],
  });
});
