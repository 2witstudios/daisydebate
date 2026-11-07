import { expect } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readBrowserConfig, readServerConfig, secretConfigKeys } from './index';
import { env } from './server-env.test-support';

setupRitewayBun();

const stripe = {
  STRIPE_SECRET_KEY: 'sk_test_configuration_fixture',
  STRIPE_WEBHOOK_SECRET: 'whsec_configuration_fixture',
  STRIPE_PREMIUM_PRICE_ID: 'price_premiumFixture',
  STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_premiumFixture',
};

test('billing is inert without configuration and preserves beta operation', () => {
  const config = readServerConfig(env);
  assert({
    given: 'the existing beta environment with no Stripe fields',
    should: 'disable billing while keeping the beta grant and allowance',
    actual: [
      config.billing,
      config.PREMIUM_BETA_GRANT,
      config.AI_ROUND_MONTHLY_CAP,
    ],
    expected: [{ kind: 'disabled' }, true, 20],
  });
});

test('complete billing configuration carries a mode but grants no release authority', () => {
  assert({
    given: 'complete test and live Stripe configuration',
    should:
      'derive the vendor mode without inventing a checkout release switch',
    actual: (['test', 'live'] as const).map(
      (mode) =>
        readServerConfig({
          ...env,
          ...stripe,
          STRIPE_SECRET_KEY: `sk_${mode}_configuration_fixture`,
        }).billing,
    ),
    expected: (['test', 'live'] as const).map((mode) => ({
      kind: 'stripe' as const,
      mode,
      secretKey: `sk_${mode}_configuration_fixture`,
      webhookSecret: stripe.STRIPE_WEBHOOK_SECRET,
      premiumPriceId: stripe.STRIPE_PREMIUM_PRICE_ID,
      portalConfigurationId: stripe.STRIPE_PORTAL_CONFIGURATION_ID,
    })),
  });
});

test('every partial Stripe configuration refuses startup', () => {
  const fields = Object.entries(stripe);
  for (let mask = 1; mask < 2 ** fields.length - 1; mask += 1) {
    const partial = Object.fromEntries(
      fields.filter((_, index) => mask & (1 << index)),
    );
    expect(() => readServerConfig({ ...env, ...partial })).toThrow(
      'Invalid server configuration',
    );
  }
});

test('invalid credentials and object identifiers expose field names only', () => {
  assert({
    given: 'a malformed value in each Stripe configuration field',
    should: 'report only its field name and never its value',
    actual: Object.keys(stripe).map((field) => {
      try {
        readServerConfig({
          ...env,
          ...stripe,
          [field]: 'private invalid value',
        });
        return 'accepted';
      } catch (error) {
        return String(error);
      }
    }),
    expected: Object.keys(stripe).map(
      (field) => `Error: Invalid server configuration: ${field}`,
    ),
  });
});

test('billing credentials are registered for redaction and excluded from browser config', () => {
  assert({
    given: 'the complete Stripe environment',
    should:
      'mark both credentials secret and expose only the existing browser allowlist',
    actual: {
      secrets: secretConfigKeys
        .filter((key) => key.startsWith('STRIPE_'))
        .sort(),
      browser: readBrowserConfig({ ...env, ...stripe }),
    },
    expected: {
      secrets: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
      browser: { PUBLIC_APP_URL: env.PUBLIC_APP_URL },
    },
  });
});

test('private economics configuration is independent of Stripe and absent from browser configuration', () => {
  const path = '/var/private/daisy-billing';
  const config = readServerConfig({
    ...env,
    BILLING_ECONOMICS_DIRECTORY: path,
  });
  assert({
    given:
      'a dedicated absolute private economics directory without Stripe configuration',
    should:
      'preserve beta operation and keep the local path off the browser allowlist',
    actual: [
      config.billing.kind,
      config.BILLING_ECONOMICS_DIRECTORY,
      readBrowserConfig({ ...env, BILLING_ECONOMICS_DIRECTORY: path }),
    ],
    expected: ['disabled', path, { PUBLIC_APP_URL: env.PUBLIC_APP_URL }],
  });
  for (const value of ['', 'public/billing', '/private\u0000invalid'])
    expect(() =>
      readServerConfig({ ...env, BILLING_ECONOMICS_DIRECTORY: value }),
    ).toThrow('Invalid server configuration: BILLING_ECONOMICS_DIRECTORY');
});
