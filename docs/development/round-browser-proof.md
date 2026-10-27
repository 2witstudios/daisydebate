# Isolated Round browser proof

The dedicated launch runner owns one native worktree slot, a private Unix
control socket, the web and realtime child processes it spawns, and disposable
browser resources. It refuses main, foreign slot databases and namespaces.
Run `bun slot:up` before the suite. Use the pinned Node 24 driver through
`ROOM_LAUNCH_NODE`; application and fixture processes use Bun.

The runner executes within the machine-wide heavy queue. It creates a temporary
local CA and server leaf, deletes the CA signer after issuance, and trusts the
public CA only in its child processes and disposable browser container. The
existing pinned Playwright image runs Chromium as its unprivileged `pwuser`
with sandboxing enabled and the version-matched official seccomp profile.
The container forwards the slot's localhost HTTPS/WSS and realtime ports plus
the actual local LiveKit ICE endpoints. No host trust store changes, insecure
browser security flags or certificate-error bypass is needed. Fake camera and
microphone inputs are controlled device fixtures; they do not establish real
hardware qualification or remote delivery.

Before the final production web instance starts, a temporary normal instance
accepts three ordinary magic-link signups, confirmations and username claims.
Those authenticated members create and cast a normal public Room and provide
fresh Ready consent. Ordinary Round commands and media reconciliation advance
the shared engine at actual server time. Each opened speech receives ordinary
signed per-seat check-in receipts before its scheduled speaker yields. The
last speech remains awaiting a human ballot; prior windows have genuine
on-time attendance. The final instance receives secret
`ATTENDANCE_PUBLIC_PROBE` configuration before `createApp`. The resource cookie
and raw configuration never enter logs, test attachments or command arguments.

The fixture imports the production startup lifecycle once. It does not start a
second availability loop, write attendance resolution flags, substitute a
health endpoint for the public check-in probe, or rewrite service leases.
Missing, revoked, expired or otherwise unusable probe resources stay unhealthy.
The configured capacity `AI_ROUND_BUSY_CAP=4` is explicit local fixture input;
there is no application default or quota bypass.

Feature proofs call `controlLaunch(operation)` from
`apps/web/e2e/support/room-launch-settled.ts`. The owner-only Unix socket accepts
`settled`, `block-check-in`, `restore-check-in`, `stop-realtime`,
`start-realtime`, `stop-web`, `start-web` and `restart-web`. Check-in outage control returns 503 from the
actual TLS ingress. Process controls stop/restart only the exact children owned
by this fixture and await their real shutdown/readiness. These controls are not
public application routes and do not change competitive authority.

Rolling-peer controls are `start-web-peer`, `use-web-peer`,
`use-primary-web` and `stop-web-peer`. The peer is another actual production
web process in the same slot, with its own availability instance and the same
configured public probe. Ingress switches only after the selected child's
real readiness endpoint responds. `settled` drains auth work in both running
children. A single fixture mailbox outlives either child; only captured mail
payloads cross its owner-only Unix socket. Vendor credentials are never sent
through that transport. Stop/start controls preserve every retained Round.

For a healthy-peer rolling proof, start the peer, witness its real service
lease and healthy sampling through the normal public probe, switch ingress,
then stop the original web process. Restore the original process and ingress
before stopping the peer. Process readiness alone is not availability proof;
the attendance evidence reader must witness durable samples and receipts.

The dedicated runner claims launch, ballot, shared Round command and attendance
suites; canonical Chromium excludes that cohort. All cases use normal accounts
and isolated slot data. Test reports distinguish local device observation,
actual peer delivery, durable vendor outcomes, bot/native publication and
whole-journey acceptance. A token, browser connection or local playback check
never proves that another participant heard audio or that capture is complete.

The carrier is a branch transition until its secure device, media, outage,
restart and multi-browser proofs pass with actual production dependencies.
Its slice PR merges only once those proofs pass in CI and its review threads are
resolved.
