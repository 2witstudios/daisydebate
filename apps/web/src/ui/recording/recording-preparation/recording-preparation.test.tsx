import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { RecordingPreparationStatus } from './recording-preparation';

setupRitewayBun();

const render = (
  preparation: Parameters<typeof RecordingPreparationStatus>[0]['preparation'],
) => renderAccessible(<RecordingPreparationStatus preparation={preparation} />);

describe('RecordingPreparationStatus', () => {
  test('says where the build really is, in the units of its step', () => {
    const encoding = render({
      stage: 'building',
      delayed: false,
      progress: { step: 'encoding', done: 2_480_000, total: 4_800_000 },
    });
    assert({
      given: 'an encode 41:20 into an 80 minute video',
      should: 'name the step and those figures, with no invented percentage',
      actual: [
        encoding.text('status'),
        encoding.attribute('progressbar', 'Progress of this step', 'value'),
        encoding.attribute('progressbar', 'Progress of this step', 'max'),
        encoding.textContent().includes('%'),
      ],
      expected: [
        'Step 3 of 5. Encoding for playback: 41:20 of 1:20:00',
        '2480000',
        '4800000',
        false,
      ],
    });
    assert({
      given: 'an upload under way',
      should: 'count files',
      actual: render({
        stage: 'building',
        delayed: false,
        progress: { step: 'uploading', done: 412, total: 3600 },
      })
        .text('status')
        .includes('Saving the video: 412 of 3600 files'),
      expected: true,
    });
  });

  test('never shows a bar for what has no figures', () => {
    assert({
      given: 'a build no worker holds yet',
      should: 'say it is waiting, with no progress bar',
      actual: [
        render({ stage: 'waiting', delayed: false })
          .text('status')
          .includes('Waiting for its turn'),
        render({ stage: 'waiting', delayed: false }).count(
          'progressbar',
          undefined,
          {
            hidden: true,
          },
        ),
        render({ stage: 'capturing' })
          .text('status')
          .includes('still being captured'),
      ],
      expected: [true, 0, true],
    });
  });

  test('tells a viewer it is delayed, and never that it is lost', () => {
    const late = render({ stage: 'waiting', delayed: true });
    assert({
      given: 'a build past its bound, and one within it',
      should: 'say it is late only when it is, and still being worked on',
      actual: [
        late.textContent().includes('taking longer than it should'),
        late.textContent().includes('still being worked on'),
        render({ stage: 'waiting', delayed: false })
          .textContent()
          .includes('taking longer'),
      ],
      expected: [true, true, false],
    });
  });
});
