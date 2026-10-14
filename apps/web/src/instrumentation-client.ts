import { z } from 'zod';

// Runs before any application module in the browser. The production CSP
// refuses eval, and Zod probes for it whenever an object schema is
// constructed, not only when one parses; browser schemas therefore run
// jitless from the start. Servers keep Zod's JIT.
z.config({ jitless: true });
