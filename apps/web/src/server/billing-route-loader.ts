/** Only process entries capture this loader; the proxy never imports Billing's vendor/Flags graph. */
export const loadBillingRoutes = () => import('./billing-app');
