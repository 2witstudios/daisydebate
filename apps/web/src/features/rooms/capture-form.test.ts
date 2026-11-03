import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { roomCommandSchema } from '@daisy/protocol';
import {
  captureFromFields,
  captureLine,
  releaseChoiceOf,
  releaseChoices,
} from './capture-form';
import { submitAssembly } from './submit-assembly';

setupRitewayBun();

describe('The capture form without script', () => {
  test('unticked boxes send nothing, and nothing chosen is off', () => {
    assert({
      given: 'no boxes, then only recording',
      should: 'answer no broadcast, with the recording as ticked',
      actual: [captureFromFields({}), captureFromFields({ recording: 'on' })],
      expected: [
        { broadcast: null, recording: false },
        { broadcast: null, recording: true },
      ],
    });
  });

  test('a Broadcast carries its release and its chat switch', () => {
    assert({
      given: 'a broadcast at a short and a long delay',
      should: 'read the policy, with chat off unless ticked',
      actual: [
        captureFromFields({ broadcast: 'on', release: 'delay:10' }),
        captureFromFields({
          broadcast: 'on',
          release: 'delay:300',
          debatersReadChat: 'on',
          recording: 'on',
        }),
      ],
      expected: [
        {
          broadcast: {
            release: { kind: 'delay', seconds: 10 },
            debatersReadChat: false,
          },
          recording: false,
        },
        {
          broadcast: {
            release: { kind: 'delay', seconds: 300 },
            debatersReadChat: true,
          },
          recording: true,
        },
      ],
    });
  });

  test('a release it cannot read is refused, not guessed', () => {
    assert({
      given:
        'no release, a junk release, and the Round-end and set-time choices no longer offered',
      should: 'answer null each time',
      actual: [
        captureFromFields({ broadcast: 'on' }),
        captureFromFields({ broadcast: 'on', release: 'delay:soon' }),
        captureFromFields({ broadcast: 'on', release: 'round_end' }),
        captureFromFields({
          broadcast: 'on',
          release: 'at',
          releaseAt: '2026-11-03T18:30',
        }),
      ],
      expected: [null, null, null, null],
    });
  });

  test('every offered choice reads back as itself', () => {
    const roundTrips = releaseChoices.map((choice) => {
      const read = captureFromFields({
        broadcast: 'on',
        release: choice.value,
      });
      return read?.broadcast
        ? releaseChoiceOf(read.broadcast.release) === choice.value
        : false;
    });
    assert({
      given: 'each release in the select',
      should: 'select the same value when stored',
      actual: roundTrips.every(Boolean),
      expected: true,
    });
  });

  test('a posted form reaches the server as a set-capture command', async () => {
    let sent: unknown;
    const form = new FormData();
    form.set('type', 'set-capture');
    form.set('commandId', 'c'.repeat(24));
    form.set('expectedVersion', '3');
    form.set('recording', 'on');
    form.set('release', 'delay:60');
    await submitAssembly(
      async (_url, init) => {
        sent = JSON.parse(String(init.body));
        return new Response('{}', { status: 409 });
      },
      'r'.repeat(24),
      form,
    );
    assert({
      given: 'a recording ticked and the broadcast left off',
      should: 'send the closed command with no stray form fields',
      actual: roomCommandSchema.safeParse(sent).success && sent,
      expected: {
        type: 'set-capture',
        commandId: 'c'.repeat(24),
        expectedVersion: 3,
        capture: { broadcast: null, recording: true },
      },
    });
  });
});

describe('What participants are told', () => {
  test('the line names both choices and the release', () => {
    assert({
      given: 'a delayed broadcast with chat off, and a recording alone',
      should: 'say exactly what happens',
      actual: [
        captureLine({
          broadcast: {
            release: { kind: 'delay', seconds: 60 },
            debatersReadChat: false,
          },
          recording: false,
        }),
        captureLine({ broadcast: null, recording: true }),
      ],
      expected: [
        'Broadcast with a 60 second delay; debaters cannot read spectator chat during the round. Not recorded.',
        'Not broadcast. Recorded.',
      ],
    });
  });
});
