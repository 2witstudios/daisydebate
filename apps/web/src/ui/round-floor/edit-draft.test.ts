import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  floorChanged,
  floorIdle,
  floorRefused,
  floorSent,
  floorUnacknowledged,
} from '../../features/messaging/round-floor/form-state';
import { floorEditSeed } from './edit-draft';
setupRitewayBun();
const requestId = 'r'.repeat(24);
const answer = floorIdle(requestId, 'Original text');
const canonical = { text: 'Canonical edit', changeVersion: 2 };
test('canonical edits update a clean editor while preserving dirty and uncertain drafts', () => {
  assert({
    given: 'a newer canonical message while an edit form exists',
    should:
      'adopt it only when no local draft or unknown command owns the field',
    actual: [
      floorEditSeed(answer, canonical, null).text,
      floorEditSeed(answer, canonical, {
        requestId,
        baseline: answer.values.text,
      }).text,
      floorEditSeed(
        floorUnacknowledged(answer.values, 'Not confirmed.'),
        canonical,
        null,
      ).text,
      floorEditSeed(floorRefused(answer.values, 'Refused.'), canonical, null)
        .text,
      floorEditSeed(floorSent('m'.repeat(24), requestId), canonical, null).text,
    ],
    expected: [
      'Canonical edit',
      'Original text',
      'Original text',
      'Original text',
      'Canonical edit',
    ],
  });
});
test('an acknowledged edit outranks a lagging protected read and releases only the old command draft', () => {
  const ack = floorChanged('m'.repeat(24), 'n'.repeat(24), 'Saved edit', 3);
  const priorDraft = { requestId, baseline: answer.values.text };
  const first = floorEditSeed(ack, canonical, priorDraft);
  const typing = { requestId: ack.requestId, baseline: first.baseline };
  assert({
    given:
      'a second edit begun before the first edit protected refresh returns',
    should:
      'keep the second command key stable as the canonical acknowledgement catches up',
    actual: [
      first.text,
      floorEditSeed(ack, { text: ack.text, changeVersion: 3 }, typing).key,
      floorEditSeed(ack, { text: 'Newer edit', changeVersion: 4 }, null).text,
    ],
    expected: ['Saved edit', first.key, 'Newer edit'],
  });
});
