import { billingRoutes } from './billing-app';

/** Source entries capture the factory; handler/runtime construction stays lazy and proxy imports none of it. */
export const loadBillingRoutes = async () => ({ billingRoutes });
