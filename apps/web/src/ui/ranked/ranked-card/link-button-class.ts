import {
  buttonClass,
  type ButtonVariant,
} from '../../components/button/button-class';
import { cn } from '../../cn';

/**
 * A link that looks like a button. Every choice on the Ranked page is a link
 * to the next step, so it works before hydration (ui-conventions).
 */
export const linkButtonClass = (
  variant: ButtonVariant,
  extra?: string,
): string => cn(buttonClass(variant), 'no-underline hover:no-underline', extra);
