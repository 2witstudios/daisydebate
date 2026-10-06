import { SkipForm } from '../../../ui/onboarding/questions/skip-form';
import { skipAction } from './actions';

/** The Skip control every numbered step shows, bound to its destination. */
export const stepSkip = (destination: string) => (
  <SkipForm action={skipAction.bind(null, destination)} />
);
