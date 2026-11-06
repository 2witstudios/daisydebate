import { assert, setupRitewayBun, test } from 'riteway/bun';
import { hasAdvisedConversationBoundary } from '../e2e/support/messaging-refusal-flight';
setupRitewayBun();

const props = { requestId: 'c'.repeat(24), retryAfterMs: 1000 };
const moduleRow = '7:I[123,["chunk","path.js"],"ConversationReconnecting"]\n';
const model = (value: unknown) => `0:${JSON.stringify(value)}\n`;

test('the held Flight oracle requires the named client reference and its own bounded advice', () => {
  assert({
    given:
      'Flight client metadata and an element carrying validated recovery props',
    should:
      'recognize advice without expecting the client-rendered status text',
    actual: hasAdvisedConversationBoundary(
      moduleRow + model(['$', '$L7', null, props]),
    ),
    expected: true,
  });
  const unrelated =
    moduleRow +
    model([
      ['$', '$L8', null, props],
      ['$', '$L7', null, {}],
      'This conversation could not load.',
    ]);
  assert({
    given:
      'the status text and valid props belong to a different client reference',
    should:
      'reject unrelated or permanent Flight instead of matching a substring',
    actual: [
      hasAdvisedConversationBoundary(unrelated),
      hasAdvisedConversationBoundary(
        moduleRow + model(['$', '$L7', null, { ...props, retryAfterMs: 0 }]),
      ),
      hasAdvisedConversationBoundary(
        moduleRow +
          model(['$', '$L7', null, { ...props, requestId: 'invalid' }]),
      ),
    ],
    expected: [false, false, false],
  });
});

test('outlined Flight export names keep exact client-reference and own-props association', () => {
  const outlined = '7:I[123,["chunk","path.js"],"$37"]\n';
  const named = '37:"ConversationReconnecting"\n';
  assert({
    given:
      'production Flight outlines the export name in a separate string row',
    should:
      'resolve that exact string row regardless of row order and preserve its own recovery props',
    actual: [
      hasAdvisedConversationBoundary(
        outlined + model(['$', '$L7', null, props]) + named,
      ),
      hasAdvisedConversationBoundary(
        named + outlined + model(['$', '$L7', null, props]),
      ),
    ],
    expected: [true, true],
  });
  assert({
    given:
      'missing, cyclic, unrelated string rows or props on another client reference',
    should:
      'reject each without guessing the recovery export or borrowing advice',
    actual: [
      hasAdvisedConversationBoundary(
        outlined + model(['$', '$L7', null, props]),
      ),
      hasAdvisedConversationBoundary(
        outlined + '37:"$38"\n38:"$37"\n' + model(['$', '$L7', null, props]),
      ),
      hasAdvisedConversationBoundary(
        outlined +
          '37:"AnotherComponent"\n' +
          named.replace('37:', '38:') +
          model(['$', '$L7', null, props]),
      ),
      hasAdvisedConversationBoundary(
        outlined + named + model(['$', '$L8', null, props]),
      ),
    ],
    expected: [false, false, false, false],
  });
});
