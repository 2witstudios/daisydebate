#!/bin/sh
# Installs Playwright's OS packages and the named browsers for a CI job, plus
# OpenSSL for ephemeral HTTPS fixture certificates and zip/unzip for
# scripts/e2e-artifact-sanitizer.ts. Usage:
#   sh scripts/ci-browsers.sh <browser>...
#
# The runner's Ubuntu mirror sometimes trickles .debs at a few KB/s, and an
# unbounded `install --with-deps` then ate the whole job timeout. Here apt
# gets per-request retries and timeouts, each attempt is killed after
# APT_ATTEMPT_SECONDS, a retry switches to the primary Ubuntu archive, and
# the third failure fails the step. The workflow restores the browsers
# (~/.cache/ms-playwright) from a cache keyed on the exact @playwright/test
# version, and the .debs (DEB_CACHE) from the newest of a rolling cache, so a
# warm run only refreshes apt's index and unpacks. DEB_CACHE keeps only the
# versions now installed; when that set changed (Ubuntu published updates),
# the script writes debs=changed to GITHUB_OUTPUT and the workflow saves it.
# EXTRA_PACKAGES names more apt packages for the same bounded install (the
# nightly drills' espeak-ng); a job that sets it keys its .debs on its own set.
set -eu

cli=apps/web/node_modules/@playwright/test/cli.js
bun=$(command -v bun)
deb_cache=${DEB_CACHE:-$HOME/.cache/daisy-apt-archives}
attempt_seconds=${APT_ATTEMPT_SECONDS:-75}
extra_packages=${EXTRA_PACKAGES:-}
case " $extra_packages" in
*[!a-z0-9.+\ -]* | *" -"*)
  echo "EXTRA_PACKAGES may name apt packages only" >&2
  exit 2
  ;;
esac

# install-deps runs apt-get itself, so the bounds live in apt's own config.
sudo tee /etc/apt/apt.conf.d/80daisy-bounded >/dev/null <<'EOF'
Acquire::Retries "3";
Acquire::http::Timeout "20";
Acquire::https::Timeout "20";
APT::Keep-Downloaded-Packages "true";
EOF

# A stalled attempt is killed through sudo and timeout, but the dpkg it had
# started can outlive both and keep the package database locked, so the
# repair below then failed the whole job. Give that dpkg LOCK_WAIT_SECONDS to
# finish, then end it; only after that is the database repaired.
await_package_lock() {
  waited=0
  while pgrep -x 'dpkg|apt-get' >/dev/null 2>&1; do
    if [ "$waited" -ge "${LOCK_WAIT_SECONDS:-30}" ]; then
      sudo pkill -KILL -x 'dpkg|apt-get' || true
      break
    fi
    sleep 1
    waited=$((waited + 1))
  done
}

mkdir -p "$deb_cache"
debs_before=$(ls "$deb_cache" | sort | cksum)
find "$deb_cache" -name '*.deb' -exec sudo cp {} /var/cache/apt/archives/ \;

# Run as root under timeout so the kill reaches apt-get, not just the CLI.
attempt=1
until sudo timeout -k 10 "$attempt_seconds" \
  "$bun" "$cli" install-deps "$@" &&
  sudo timeout -k 10 "$attempt_seconds" \
    apt-get install -y --no-install-recommends openssl zip unzip $extra_packages; do
  if [ "$attempt" -ge 3 ]; then
    echo "Browser OS dependencies failed after $attempt attempts" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  echo "Retrying browser OS dependencies on archive.ubuntu.com (attempt $attempt)" >&2
  await_package_lock
  sudo dpkg --configure -a
  # ubuntu-24.04 runners resolve the archive through mirror+file, which only
  # fails over on errors, never on a slow mirror. The list leads with a
  # regional host (azure., then us-east-2.ec2. from 2026-11); any of them
  # becomes the primary archive.
  sudo sed -E -i 's#://[A-Za-z0-9.-]+\.archive\.ubuntu\.com/#://archive.ubuntu.com/#g' \
    /etc/apt/apt-mirrors.txt
done

cp /var/cache/apt/archives/*.deb "$deb_cache"/ 2>/dev/null || true
# Only the installed versions, so the rolling cache follows Ubuntu's updates
# instead of growing with them.
for deb in "$deb_cache"/*.deb; do
  [ -f "$deb" ] || continue
  # Under set -e an unreadable archive must not end the step: it reads as no
  # package, matches no installed version and is pruned.
  package=$(dpkg-deb -f "$deb" Package 2>/dev/null) || package=""
  version=$(dpkg-deb -f "$deb" Version 2>/dev/null) || version=""
  installed=""
  [ -z "$package" ] || installed=$(dpkg-query -W -f='${Version}' "$package" 2>/dev/null || true)
  [ -n "$version" ] && [ "$installed" = "$version" ] || rm "$deb"
done
if [ "$(ls "$deb_cache" | sort | cksum)" != "$debs_before" ] && [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "debs=changed" >> "$GITHUB_OUTPUT"
fi
"$bun" "$cli" install "$@"
