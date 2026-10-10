import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import {
  buildChannelTopic,
  buildDebateTopic,
  buildRoomTopic,
  buildUserInboxTopic,
} from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

async function restrictedFrameParser() {
  const directory = mkdtempSync(join(tmpdir(), 'daisy-frame-validation-'));
  try {
    const entry = join(directory, 'entry.ts');
    const reader = resolve(
      import.meta.dirname,
      '../src/features/realtime/topic-subscriptions.ts',
    );
    writeFileSync(
      entry,
      `import {parseServerMessage} from ${JSON.stringify(reader)}; globalThis.parseRealtimeFrame=parseServerMessage;`,
    );
    const bundle = await Bun.build({
      entrypoints: [entry],
      target: 'browser',
      format: 'iife',
    });
    const output = bundle.outputs[0];
    if (!bundle.success || !output)
      throw new Error('Realtime browser validation bundle unavailable');
    const context = createContext({});
    runInContext(await output.text(), context);
    // Module initialization can run in an automation world before actual CSP callbacks.
    runInContext(
      'globalThis.Function = function () { throw new EvalError("evaluation refused") }',
      context,
    );
    return (frame: object) =>
      JSON.parse(
        runInContext(
          `JSON.stringify(parseRealtimeFrame(${JSON.stringify(JSON.stringify(frame))}))`,
          context,
        ),
      );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('actual browser frame bundle validates after dynamic-code permission changes', async () => {
  const parse = await restrictedFrameParser();
  const id = 'b'.repeat(24);
  const bells = [
    {
      topic: buildRoomTopic(id),
      payload: { kind: 'room.changed', ids: [id], entityVersion: 1 },
    },
    {
      topic: buildDebateTopic(id),
      payload: { kind: 'debate.phase-changed', ids: [id], entityVersion: 1 },
    },
    {
      topic: buildChannelTopic(id),
      payload: { kind: 'channel.changed', channelId: id, changeVersion: 1 },
    },
    {
      topic: buildUserInboxTopic(id),
      payload: { kind: 'messaging.inbox.changed' },
    },
  ];
  const frames = [
    { v: 1, type: 'ready' },
    { v: 1, type: 'pong', id: 'ping-1' },
    ...bells.map((bell) => ({ v: 1, type: 'event', position: '1:1', ...bell })),
  ];
  assert({
    given: 'the actual reader initializes before Function is refused',
    should: 'validate ready, pong and canonical events without generating code',
    actual: frames.map(parse),
    expected: frames,
  });
  assert({
    given: 'a malformed frame under the same restriction',
    should: 'retain strict framing refusal',
    actual: [
      parse({ v: 1, type: 'ready', ticket: 'not-a-frame-field' }),
      parse({
        ...frames[2],
        topic: buildChannelTopic('c'.repeat(24)),
      }),
    ],
    expected: [null, null],
  });
});
