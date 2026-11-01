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

## Prepared browser tooling

`bun scripts/heavy.ts bun apps/web/e2e/support/launch-browser-image.ts`
prepares the Launch-owned image. The canonical runner calls the same preparer
before generating certificates. One eight-minute total budget covers exact-base
acquisition, container creation/execution, commit, inspection, archive and owned
cleanup. Browser startup retains its separate 120-second deadline.

The preparer verifies the immutable upstream Playwright 1.63.0 Noble index,
native manifest/config and published root filesystem layers. An exact cached
base avoids acquisition; a miss gets one explicit bounded pull. The preparation
container uses `--pull=never` after verification. A committed NSS shell recipe
arrives over stdin. There is no filesystem context, checkout, fixture CA/key,
mount or user NSS database. Runtime still imports its own fresh CA and executes
Chromium as pwuser with the existing sandbox, seccomp and network topology.

Docker CLI proxy configuration can inject plaintext credentials into container
environment variables. Every proxy variable is explicitly overridden with an
empty value, and the actual container's environment/config/mounts are checked
against the pinned base plus a strict allowlist before it starts and again
before commit. Unexpected environment, commands, mounts or labels fail closed;
raw values never enter diagnostics. The committed artifact is checked for safe
configuration, the native base layers plus one preparation layer, the actual
NSS package inventory hash and empty fixture trust state. Execution uses its
validated immutable image ID with `--pull=never`.

The descriptor deliberately sets the exact artifact label
`desktop.docker.io/ports.scheme=v2` at commit on every platform. A no-package local
create/commit differential measured this same non-secret enum added at commit
by the Desktop environment (CLI 27.5.1, daemon 29.7.2, Desktop 4.90.0). This is
our reviewed artifact contract, not a claim of a published Desktop guarantee.
Its absence, substitution and every additional label are rejected. The verified
upstream base still has only its independently pinned upstream labels.

The uniquely named preparation container is forcibly removed and its absence
verified on success, failure and interruption, including partial creation and
commit failures. Commit uses a unique temporary local tag until validation;
failed partial outputs are removed. No shared Docker configuration, builder,
container, image reference or global prune is changed. Docker CLI/daemon
versions, the recipe, descriptor, implementation, Bun version, lockfile,
platform and explicit dependency refresh revision participate in cache identity.

The descriptor records full upstream index/native manifest/config digests,
published layer identities and the native Ubuntu `libnss3-tools` deb's HTTPS URL,
SHA256, byte count, version, architecture and dependency contract. The recipe
verifies the download and package metadata, checks the base's installed
dependencies with `dpkg --compare-versions`, then uses ordinary `dpkg --install`.
It has no apt fallback, force option or dependency resolver. Update the descriptor
and refresh revision deliberately for security refreshes. The actual complete
package inventory is recorded at `/usr/local/share/daisy-launch-packages.txt`;
identical image bytes across cold rebuilds are not promised. Cold preparation
needs the pinned artifact host; warm runtime has no package download or image
acquisition fallback.

An optional directory argument saves/loads `image.tar` and `receipt.json` for
CI. Existing SHA-pinned Actions cache uses exact OS/architecture/input keys;
inexact restores are discarded only from the owned archive directory. Only
same-repository PR and main-push events save; forks/manual runs cannot publish
reusable caches. GitHub ref scoping applies. Local and restored images undergo
configuration, layer, package and filesystem checks, independently of cache-hit
metadata. The receipt binds the expected input key and actual immutable image
ID. Cache is an optimization within its repository/event trust boundary, not a
signature or acceptance authority. A rejected archive gets one bounded rebuild;
failed writes remove their own partial files.

The real preparation lifecycle proof exercises timeout, partial creation,
pre-execution credential/config rejection and commit failure against owned
Docker resources. The browser trust proof denies configured repository hosts
only in its disposable proof containers while actual fixture HTTPS/WSS and
controlled media remain usable. It proves fresh CA trust, cross-run isolation,
wrong-CA and hostname rejection and cleanup. The canonical native suite supplies
the real application/media journey outcomes and retains its selected-spec guard.

References read before configuration: [Playwright 1.63.0 Docker guide](https://github.com/microsoft/playwright/blob/v1.63.0/docs/src/docker.md),
[its Noble source](https://github.com/microsoft/playwright/blob/v1.63.0/utils/docker/Dockerfile.noble),
[Docker create](https://docs.docker.com/reference/cli/docker/container/create/),
[Docker commit](https://docs.docker.com/reference/cli/docker/container/commit/),
[Docker proxy credential persistence](https://docs.docker.com/engine/cli/proxy/),
[Ubuntu Noble NSS metadata](https://packages.ubuntu.com/noble-updates/libnss3-tools),
[Noble curl 8.5.0](https://manpages.ubuntu.com/manpages/noble/en/man1/curl.1.html),
[Noble dpkg 1.22.6](https://manpages.ubuntu.com/manpages/noble/en/man1/dpkg.1.html),
[Actions cache 6.1.0](https://github.com/actions/cache/tree/v6.1.0) and
[GitHub cache trust/ref restrictions](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching).
