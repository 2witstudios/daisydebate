#!/bin/sh
# Installs Playwright's OS packages and the named browsers for a CI job, plus
# zip/unzip for scripts/e2e-artifact-sanitizer.ts. Usage:
#   sh scripts/ci-browsers.sh <browser>...
#
# The runner's Ubuntu mirror sometimes trickles .debs at a few KB/s, and an
# unbounded `install --with-deps` then ate the whole job timeout. Here apt
# gets per-request retries and timeouts, each attempt is killed after
# APT_ATTEMPT_SECONDS, a retry switches to the primary Ubuntu archive, and
# the third failure fails the step. The workflow restores the browsers
# (~/.cache/ms-playwright) and the downloaded .debs (DEB_CACHE) from a cache
# keyed on the exact @playwright/test version, so a warm run only refreshes
# apt's index and unpacks.
set -eu

cli=apps/web/node_modules/@playwright/test/cli.js
bun=$(command -v bun)
deb_cache=${DEB_CACHE:-$HOME/.cache/daisy-apt-archives}
attempt_seconds=${APT_ATTEMPT_SECONDS:-120}

# install-deps runs apt-get itself, so the bounds live in apt's own config.
sudo tee /etc/apt/apt.conf.d/80daisy-bounded >/dev/null <<'EOF'
Acquire::Retries "3";
Acquire::http::Timeout "20";
Acquire::https::Timeout "20";
APT::Keep-Downloaded-Packages "true";
EOF

mkdir -p "$deb_cache"
find "$deb_cache" -name '*.deb' -exec sudo cp {} /var/cache/apt/archives/ \;

# Run as root under timeout so the kill reaches apt-get, not just the CLI.
attempt=1
until sudo timeout -k 10 "$attempt_seconds" \
  "$bun" "$cli" install-deps "$@" &&
  sudo timeout -k 10 "$attempt_seconds" \
    apt-get install -y --no-install-recommends zip unzip; do
  if [ "$attempt" -ge 3 ]; then
    echo "Browser OS dependencies failed after $attempt attempts" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  echo "Retrying browser OS dependencies on archive.ubuntu.com (attempt $attempt)" >&2
  sudo dpkg --configure -a
  sudo sed -i 's#http://azure\.archive\.ubuntu\.com/#http://archive.ubuntu.com/#' \
    /etc/apt/sources.list.d/*.sources /etc/apt/sources.list 2>/dev/null || true
done

cp /var/cache/apt/archives/*.deb "$deb_cache"/ 2>/dev/null || true
"$bun" "$cli" install "$@"
