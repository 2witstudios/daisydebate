import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import {
  AuthFrame,
  AuthHeading,
  taglinePanel,
} from '../../auth/auth-frame/auth-frame';

/**
 * After the age step, for a member aged 13 to 17 (YLS-8, the
 * YOnboardingAge board): one line naming where they play, then on to the
 * username. A plain link, so it works before hydration.
 */
export function YouthLanding({
  next,
  lobbyName,
}: {
  readonly next: string;
  readonly lobbyName: string;
}) {
  return (
    <AuthFrame panel={taglinePanel} footer="Next: choose your username.">
      <AuthHeading
        eyebrow="Before you start"
        title={`You’re in the ${lobbyName} lobby`}
      >
        Thanks. Here’s where you’ll play.
      </AuthHeading>
      <a
        href={next}
        className={`${buttonClass('primary')} h-auth-control self-start no-underline hover:no-underline`}
      >
        Continue
        <Icon name="arrowRight" size={18} />
      </a>
    </AuthFrame>
  );
}
