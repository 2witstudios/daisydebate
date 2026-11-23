import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { ProfileReports, profileReportTargets } from './profile-reports';

setupRitewayBun();

const profileId = 'p'.repeat(24);
const photoId = 'f'.repeat(24);
const shown = { profileId, displayName: 'Ada', bio: 'Hi.', photoId };
const nothing = {
  profileId: null,
  displayName: null,
  bio: null,
  photoId: null,
};

describe('profileReportTargets', () => {
  test('what is shown is what may be reported', () => {
    assert({
      given: 'a photo, display name and bio, then a bio alone, then nothing',
      should:
        'report the photo by its id and the text by the profile id, only while each is shown',
      actual: [
        profileReportTargets(shown).map((t) => [t.targetKind, t.targetId]),
        profileReportTargets({ ...nothing, profileId, bio: 'Hi.' }).map(
          (t) => t.targetKind,
        ),
        profileReportTargets(nothing),
      ],
      expected: [
        [
          ['profile_photo', photoId],
          ['profile_display_name', profileId],
          ['profile_bio', profileId],
        ],
        ['profile_bio'],
        [],
      ],
    });
  });
});

describe('ProfileReports', () => {
  test('forms and the answer', () => {
    const view = renderAccessible(
      <ProfileReports shown={shown} notice="received" action={() => {}} />,
    );
    const reports = view.within('group', 'Report this profile');
    const targets = reports
      .all('button', 'Send report')
      .map(
        (button) =>
          (
            button.closest('form')?.elements.namedItem('targetKind') as
              HTMLInputElement | null | undefined
          )?.value,
      );
    const reasons = reports
      .all('option')
      .map((option) => option.getAttribute('value'));
    assert({
      given: 'a full profile and a report that reached moderation',
      should:
        'offer three report forms with the safety reasons and say it was received',
      actual: [
        targets,
        reasons.includes('impersonation'),
        reasons.includes('result_dispute'),
        reports
          .text('status')
          .includes('Your report reached the moderation team'),
      ],
      expected: [
        ['profile_photo', 'profile_display_name', 'profile_bio'],
        true,
        false,
        true,
      ],
    });
  });

  test('nothing to report', () => {
    assert({
      given: 'a profile that shows nothing and no answer',
      should: 'render nothing',
      actual: (() => {
        const view = renderAccessible(
          <ProfileReports shown={nothing} notice={null} action={() => {}} />,
        );
        return [
          view.textContent(),
          view.count('group', undefined, { hidden: true }),
          view.count('generic', undefined, { hidden: true }),
        ];
      })(),
      expected: ['', 0, 0],
    });
  });
});
