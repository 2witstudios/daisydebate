import { Announcement } from '../../components/announcement/announcement';
import { Button } from '../../components/button/button';
import { renderToStaticMarkup } from 'react-dom/server';
import { AssemblyCommandForm } from './assembly-command-form';
import { idle } from '../../../features/forms/form-state';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { findElements, byText } from '../../test-support/find-elements';
import {
  StartControl,
  ReadyControl,
  postRoundCallText,
} from './assembly-readiness';
import { ContentWaiverForm } from './content-waiver-form';
import { twoSides } from '@daisy/protocol/seats';
import { PopoverDialog } from '../../components/popover/popover-dialog';

setupRitewayBun();
const base = {
  contentWaiver: null,
  contentWaiverVersion: null,
  captureNotice: null,
  postRoundCall: false,
  capture: null,
  resolutionDraw: null,
  botAdmission: null,
  teamOneSide: 'affirmative' as const,
  status: 'assembling' as const,
  competitionType: 'casual' as const,
  version: 7,
  participants: [
    {
      id: 'seat',
      actorId: 'viewer',
      label: 'Viewer',
      consentVersion: 8,
      kind: 'human' as const,
      seat: { kind: 'judge', slot: 0 } as const,
      teamOpen: false,
      positionOpen: false,
      rating: null,
      needsReady: true,
      ready: 'not-ready' as const,
      eligible: true,
    },
  ],
  readiness: { available: true, version: 7, readyActorIds: [] },
  definition: {
    sides: [...twoSides],
    seats: {
      sides: { affirmative: 1, negative: 1 },
      speakers: 0,
      judges: 1,
      moderators: 0 as const,
    },
  },
  capabilities: { canReady: true, host: true, canStart: false },
  startRefusal: 'not-ready' as const,
};
const action = async () => idle();
type Props = Parameters<typeof ReadyControl>[0];
const controls = (props: Props) => [ReadyControl(props), StartControl(props)];
const props = {
  view: base,
  actorId: 'viewer',
  local: { devicesPassed: false, unreadyPending: false },
  action,
  waiverAction: action,
  commandIds: {
    ready: 'ready-id',
    unready: 'unready-id',
    'start-round': 'launch-id',
  },
};

describe('native room readiness and Start round controls', () => {
  test('an unsigned member is offered the waiver form in place', () => {
    const offered = (contentWaiver: 'signed' | 'unsigned') =>
      findElements(
        ReadyControl({ ...props, view: { ...base, contentWaiver } }),
        (element) => element.type === ContentWaiverForm,
      ).length;
    assert({
      given: 'an unsigned and a signed member',
      should: 'offer the form only to the unsigned one',
      actual: [offered('unsigned'), offered('signed')],
      expected: [1, 0],
    });
  });

  test('a captured Round shows its notice and Ready states it', () => {
    const notice = { version: 'casual-draft-1', text: 'Exact notice words.' };
    const ready = ReadyControl({
      ...props,
      view: { ...base, captureNotice: notice },
    });
    assert({
      given: 'a Room with a capture notice',
      should: 'show its exact words and post its version natively',
      actual: [
        findElements(
          ready,
          (element) => element.props.children === 'Exact notice words.',
        ).length,
        findElements(
          ready,
          (element) =>
            element.type === 'input' &&
            element.props.name === 'noticeVersion' &&
            element.props.value === notice.version,
        ).length,
      ],
      expected: [1, 1],
    });
  });

  test('I’m ready asks first only when there is something to agree to', () => {
    const notice = { version: 'casual-draft-1', text: 'Exact notice words.' };
    const opener = (view: Props['view']) =>
      findElements(
        ReadyControl({ ...props, view }),
        (element) =>
          element.type === Button &&
          element.props.popoverTarget === 'ready-confirm' &&
          element.props.popoverTargetAction === undefined,
      ).length;
    const popovers = (view: Props['view']) =>
      findElements(
        ReadyControl({ ...props, view }),
        (element) => element.type === PopoverDialog,
      ).length;
    assert({
      given:
        'a Room with a capture notice, an unsigned ranked member, and a Room with neither',
      should:
        'open a confirmation from I’m ready for the first two, and submit Ready directly for the last',
      actual: [
        [
          opener({ ...base, captureNotice: notice }),
          popovers({ ...base, captureNotice: notice }),
        ],
        [
          opener({ ...base, contentWaiver: 'unsigned' }),
          popovers({ ...base, contentWaiver: 'unsigned' }),
        ],
        [
          opener(base),
          popovers(base),
          byText(ReadyControl(props), Button, 'I’m ready')?.props.type,
        ],
      ],
      expected: [
        [1, 1],
        [1, 1],
        [0, 0, 'submit'],
      ],
    });
  });

  test('a Ready standing from another tab still offers this tab’s Turn on', () => {
    const view = {
      ...base,
      participants: [
        {
          ...base.participants[0]!,
          seat: { kind: 'side', side: 'affirmative', slot: 0 } as const,
          ready: 'ready' as const,
        },
      ],
      capabilities: { ...base.capabilities, canStart: true },
    };
    const tree = ReadyControl({ ...props, view, turnOnDevices: () => {} });
    assert({
      given: 'a ready debater host whose devices this tab has not turned on',
      should:
        'offer Turn on camera and mic in place of Start round, and keep Not ready',
      actual: [
        Boolean(byText(tree, Button, 'Turn on camera and mic')),
        Boolean(byText(tree, Button, 'Start round')),
        Boolean(byText(tree, Button, 'Not ready')),
      ],
      expected: [true, false, true],
    });
  });

  test('the host’s Start round sits under their tile once they are ready', () => {
    const ready = { ...base.participants[0]!, ready: 'ready' as const };
    const start = (participants: Props['view']['participants'], host = true) =>
      Boolean(
        byText(
          ReadyControl({
            ...props,
            view: {
              ...base,
              participants,
              capabilities: { ...base.capabilities, host },
            },
          }),
          Button,
          'Start round',
        ),
      );
    assert({
      given:
        'a host not yet ready, the same host ready, a host with no seat, and a ready guest',
      should: 'offer Start round to the ready host and the seatless host only',
      actual: [
        start([base.participants[0]!]),
        start([ready]),
        start([]),
        start([ready], false),
      ],
      expected: [false, true, true, false],
    });
  });

  test('a Room with the post-round call says so before Ready, once two people are in it', () => {
    const one = base.participants[0]!;
    const other = { ...one, id: 'second-seat', actorId: 'second-actor' };
    const bot = { ...other, kind: 'bot' as const };
    const told = (
      postRoundCall: boolean,
      participants: (typeof one | typeof bot)[],
    ) =>
      findElements(
        ReadyControl({
          ...props,
          view: { ...base, postRoundCall, participants },
        }),
        (element) => element.props.children === postRoundCallText,
      ).length;
    assert({
      given:
        'the call chosen with two people, with one person and a bot, and not chosen with two people',
      should:
        'tell the seat only when it was chosen and the cast would get a call',
      actual: [
        told(true, [one, other]),
        told(true, [one, bot]),
        told(false, [one, other]),
      ],
      expected: [1, 0, 0],
    });
  });

  test('judge Ready submits a versioned command through the injected real action', () => {
    const tree = controls(props);
    const form = findElements(
      tree,
      (element) => element.type === AssemblyCommandForm,
    )[0];
    assert({
      given: 'an eligible judge without local device checks',
      should:
        'keep a native form action with the current version and command identity',
      actual: [
        form?.props.action === action,
        findElements(form, (element) => element.type === 'input').map(
          (input) => [input.props.name, input.props.value],
        ),
        byText(tree, Button, 'I’m ready')?.props.disabled,
      ],
      expected: [
        true,
        [
          ['type', 'ready'],
          ['expectedVersion', '7'],
          ['commandId', 'ready-id'],
          ['expectedConsentVersion', '8'],
        ],
        false,
      ],
    });
  });

  test('Unready carries own consent revision and Start round carries none', () => {
    const tree = controls({
      ...props,
      view: {
        ...base,
        participants: [{ ...base.participants[0]!, ready: 'ready' }],
        capabilities: { ...base.capabilities, canStart: true },
      },
    });
    const forms = findElements(
      tree,
      (element) => element.type === AssemblyCommandForm,
    );
    assert({
      given: 'the viewer is ready at consent revision eight',
      should:
        'put Start round first with no readiness field, then fence withdrawal using that participant revision',
      actual: forms.map((form) =>
        findElements(
          form,
          (element) =>
            element.type === 'input' &&
            element.props.name === 'expectedConsentVersion',
        ).map((input) => input.props.value),
      ),
      expected: [[], ['8']],
    });
  });

  test('Start round follows CAP capability and local invalidation fence', () => {
    const allowed = {
      ...props,
      view: {
        ...base,
        participants: [{ ...base.participants[0]!, ready: 'ready' as const }],
        capabilities: { ...base.capabilities, canStart: true },
        startRefusal: null,
      },
    };
    assert({
      given:
        'CAP permits Start round, then a local unready remains unacknowledged',
      should:
        'block Start round immediately without changing the server projection',
      actual: [
        byText(controls(allowed), Button, 'Start round')?.props.disabled,
        byText(
          controls({
            ...allowed,
            local: { devicesPassed: true, unreadyPending: true },
          }),
          Button,
          'Start round',
        )?.props.disabled,
        allowed.view.capabilities.canStart,
      ],
      expected: [false, true, true],
    });
  });

  test('non-host receives no Start round control', () => {
    const tree = controls({
      ...props,
      view: {
        ...base,
        capabilities: { ...base.capabilities, host: false, canStart: true },
      },
    });
    assert({
      given: 'a seated participant without host authority',
      should: 'render Ready but no Start round submission',
      actual: [
        Boolean(byText(tree, Button, 'I’m ready')),
        Boolean(byText(tree, Button, 'Start round')),
      ],
      expected: [true, false],
    });
  });

  test('device loss blocks a debater host before Unready can be acknowledged', () => {
    const view = {
      ...base,
      participants: [
        {
          ...base.participants[0]!,
          seat: { kind: 'side', side: 'affirmative', slot: 0 } as const,
          ready: 'ready' as const,
        },
      ],
      capabilities: { ...base.capabilities, canStart: true },
      startRefusal: null,
    };
    const tree = controls({ ...props, view });
    assert({
      given:
        'CAP still reports ready while the human host has lost device checks',
      should: 'block Start round synchronously and still offer Unready',
      actual: [
        Boolean(byText(tree, Button, 'Start round')),
        byText(tree, Button, 'Turn on camera and mic')?.props.disabled,
        byText(tree, Button, 'Not ready')?.props.disabled,
        view.participants[0]?.ready,
      ],
      expected: [false, true, false, 'ready'],
    });
  });

  test('Start round names what it waits on', () => {
    const bot = (role: 'affirmative' | 'negative') => ({
      ...base.participants[0]!,
      id: role,
      actorId: role,
      kind: 'bot' as const,
      seat: { kind: 'side' as const, side: role, slot: 0 },
      teamOpen: false,
      positionOpen: false,
      rating: null,
      needsReady: false,
    });
    const waiting = controls(props);
    const clear = controls({
      ...props,
      view: {
        ...base,
        participants: [
          { ...base.participants[0]!, ready: 'ready' },
          bot('affirmative'),
          bot('negative'),
        ],
        capabilities: { ...base.capabilities, canStart: true },
        startRefusal: null,
      },
    });
    assert({
      given: 'open debater seats and the unready viewer, then a ready room',
      should: 'list the seats and the viewer, then nothing',
      actual: [
        byText(waiting, Announcement, 'Waiting on')?.props.children,
        byText(clear, Announcement, 'Waiting on'),
      ],
      expected: ['Waiting on Affirmative, Negative, You', undefined],
    });
  });

  test('only the host reads that the Start waits on their device check', () => {
    const debater = {
      ...base.participants[0]!,
      seat: { kind: 'side', side: 'affirmative', slot: 0 } as const,
      ready: 'ready' as const,
    };
    const notice = (host: boolean) =>
      byText(
        StartControl({
          ...props,
          view: {
            ...base,
            participants: [
              debater,
              {
                ...debater,
                actorId: 'bot',
                kind: 'bot' as const,
                seat: { kind: 'side', side: 'negative', slot: 0 } as const,
                teamOpen: false,
                positionOpen: false,
                rating: null,
                needsReady: false,
              },
              {
                ...debater,
                actorId: 'judge-bot',
                kind: 'bot' as const,
                seat: { kind: 'judge', slot: 0 } as const,
                teamOpen: false,
                positionOpen: false,
                rating: null,
                needsReady: false,
              },
            ],
            capabilities: { ...base.capabilities, host, canStart: true },
            startRefusal: null,
          },
        }),
        Announcement,
        'Waiting on',
      )?.props.children;
    assert({
      given: 'a standing Ready in a tab that has not checked its devices',
      should: 'name the check to the host, whose Start it fences, and no other',
      actual: [notice(true), notice(false)],
      expected: ['Waiting on your camera and mic', undefined],
    });
  });
});

test('host Start round refuses unavailable admission without changing Ready or command authority', () => {
  const tree = ReadyControl({
    ...props,
    view: {
      ...base,
      participants: [{ ...base.participants[0]!, ready: 'ready' as const }],
      botAdmission: { kind: 'unavailable' },
      capabilities: { ...base.capabilities, canStart: true },
    },
  });
  const button = byText(tree, Button, 'Start round');
  assert({
    given: 'an otherwise startable host Room with unavailable bot admission',
    should: 'disable only the Start round submission',
    actual: button?.props.disabled,
    expected: true,
  });
});

describe('the tile’s one button (ADR 0145)', () => {
  test('before and after a debater’s devices pass', () => {
    const debater = {
      ...base,
      participants: base.participants.map((p) => ({
        ...p,
        seat: { kind: 'side', side: 'affirmative', slot: 0 } as const,
      })),
    };
    let turnedOn = 0;
    const turnOnDevices = () => {
      turnedOn += 1;
    };
    const unchecked = ReadyControl({ ...props, view: debater, turnOnDevices });
    const before = renderToStaticMarkup(<>{unchecked}</>);
    const button = byText(unchecked, Button, 'Turn on camera and mic');
    (button?.props as { onClick?: () => void } | undefined)?.onClick?.();
    const after = renderToStaticMarkup(
      <>
        {ReadyControl({
          ...props,
          view: debater,
          local: { devicesPassed: true, unreadyPending: false },
          turnOnDevices,
        })}
      </>,
    );
    const judge = renderToStaticMarkup(
      <>{ReadyControl({ ...props, turnOnDevices })}</>,
    );
    assert({
      given:
        'a debater whose devices have not passed, the same debater after they pass, and a judge',
      should:
        'offer Turn on camera and mic in place of I’m ready, then I’m ready, and never ask a judge for devices',
      actual: {
        before: [
          before.includes('Turn on camera and mic'),
          before.includes('I’m ready'),
        ],
        turnedOn,
        after: [
          after.includes('Turn on camera and mic'),
          after.includes('I’m ready'),
        ],
        judge: judge.includes('Turn on camera and mic'),
      },
      expected: {
        before: [true, false],
        turnedOn: 1,
        after: [false, true],
        judge: false,
      },
    });
  });
});

for (const standing of ['not-ready', 'ready'] as const) {
  test(`device initialization preserves the ${standing} debater’s action`, () => {
    const view = {
      ...base,
      participants: [
        {
          ...base.participants[0]!,
          seat: { kind: 'side', side: 'affirmative', slot: 0 } as const,
          ready: standing,
        },
      ],
    };
    const pending = ReadyControl({ ...props, view });
    const initialized = ReadyControl({
      ...props,
      view,
      turnOnDevices: () => {},
    });
    const action = (tree: typeof pending) =>
      byText(tree, Button, 'Turn on camera and mic');
    assert({
      given: `a ${standing} debater before and after local devices initialize`,
      should:
        'keep the same action in place, disabled only until it can turn on devices, and preserve withdrawal',
      actual: [
        Boolean(action(pending)),
        action(pending)?.props.disabled,
        action(initialized)?.props.disabled ?? false,
        Boolean(byText(pending, Button, 'Not ready')),
        renderToStaticMarkup(<>{pending}</>).includes(
          'Check your camera and microphone before readying.',
        ),
      ],
      expected: [true, true, false, standing === 'ready', false],
    });
  });
}
