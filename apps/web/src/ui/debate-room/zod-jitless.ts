import { config } from 'zod';

/**
 * Zod probes `Function("")` when it builds an object schema unless JIT is
 * off, and the nonce CSP reports that probe as a script-src violation. The
 * live room builds protocol schemas in the browser (the round position
 * reader), so it turns JIT off there before they load; the server keeps it.
 * Import first.
 */
if (typeof window !== 'undefined') config({ jitless: true });
