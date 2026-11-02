// Runs before any client code (Next 16 docs: instrumentation-client), so the
// browser capture initializes before a page can fail. ADR 0037: the config
// file itself is the gate — without the DSN the root layout writes on `<html>`
// it initializes nothing.
import './features/telemetry/sentry.client.config';
