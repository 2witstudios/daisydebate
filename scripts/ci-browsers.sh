#!/bin/sh
# Installs Playwright's OS packages and the named browsers for a CI job, plus
# OpenSSL for ephemeral HTTPS fixture certificates and zip/unzip for
# scripts/e2e-artifact-sanitizer.ts. Usage:
#   sh scripts/ci-browsers.sh <browser>...
#
# The runner's Ubuntu mirror sometimes trickles .debs at a few KB/s, and an
# unbounded `install --with-deps` then ate the whole job timeout. Here apt
# gets per-request retries and timeouts, and each attempt has two budgets:
# APT_UPDATE_SECONDS for the index refresh and APT_INSTALL_SECONDS for the
# install, so a slow `apt-get update` cannot spend the time the install needs
# (main at 690ed5ffb: a 50 s refresh left 25 s, and the install was killed
# mid-unpack). A retry repairs the package database, switches to the primary
# Ubuntu archive, and the third failure fails the step. Worst case, with the
# defaults and timeout's 10 s kill grace: three attempts of (45+10)+(75+10)
# and two repairs of 30 (lock wait) + (75+10), 650 s. The workflow's
# 12-minute step bound then leaves about 70 s for the browser download
# (restored from cache on a warm run), and sits inside each browser job's
# limit (the admin job's 15 minutes is the tightest). The workflow restores the browsers
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
update_seconds=${APT_UPDATE_SECONDS:-45}
install_seconds=${APT_INSTALL_SECONDS:-75}
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

# A killed install can leave a package unpacked against an older dependency
# (libgbm1 at the new mesa, mesa-libgallium at the old), and then
# `dpkg --configure -a` exits 1; under set -e that ended the job on attempt 2.
# The repair is best effort, bounded like an install, and never ends the
# script: the next attempt's install is the real judge.
repair_packages() {
  await_package_lock
  sudo timeout -k 10 "$install_seconds" sh -c \
    'dpkg --configure -a; apt-get -f install -y --no-install-recommends' ||
    echo "Package repair failed; the next attempt's install decides" >&2
}

# install-deps chains `apt-get update && apt-get install`. The index was just
# refreshed under its own budget, so a PATH shim skips that second refresh
# and the install budget is the install's alone. If Playwright stops calling
# apt-get through PATH, the refresh merely runs twice.
shim=$(mktemp -d)
trap 'rm -rf "$shim"' EXIT
apt_get=$(command -v apt-get)
cat >"$shim/apt-get" <<EOF
#!/bin/sh
[ "\${1:-}" = update ] && exit 0
exec "$apt_get" "\$@"
EOF
cat >"$shim/install" <<EOF
"$bun" "$cli" install-deps "\$@" &&
  apt-get install -y --no-install-recommends openssl zip unzip $extra_packages
EOF
chmod 755 "$shim/apt-get"

mkdir -p "$deb_cache"
debs_before=$(ls "$deb_cache" | sort | cksum)
find "$deb_cache" -name '*.deb' -exec sudo cp {} /var/cache/apt/archives/ \;

# Run as root under timeout so the kill reaches apt-get, not just the CLI.
attempt=1
until sudo timeout -k 10 "$update_seconds" apt-get update &&
  sudo timeout -k 10 "$install_seconds" \
    env PATH="$shim:$PATH" sh -e "$shim/install" "$@"; do
  if [ "$attempt" -ge 3 ]; then
    echo "Browser OS dependencies failed after $attempt attempts" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  echo "Retrying browser OS dependencies on archive.ubuntu.com (attempt $attempt)" >&2
  # ubuntu-24.04 runners resolve the archive through mirror+file, which only
  # fails over on errors, never on a slow mirror. The list leads with a
  # regional host (azure., then us-east-2.ec2. from 2026-11); any of them
  # becomes the primary archive, before the repair can download anything.
  sudo sed -E -i 's#://[A-Za-z0-9.-]+\.archive\.ubuntu\.com/#://archive.ubuntu.com/#g' \
    /etc/apt/apt-mirrors.txt
  repair_packages
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
