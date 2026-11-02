#!/bin/sh
set -eu
# Exact artifact plus already-installed, immutable native base dependencies.
version=$1 architecture=$2 url=$3 checksum=$4 bytes=$5 dependencies=$6
stage() { printf 'daisy-image-stage:%s\n' "$1"; }
package=/tmp/daisy-launch-nss.deb
trap 'rm -f "$package"' EXIT
stage artifact-download
curl --disable --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
  --connect-timeout 10 --max-time 45 --retry 1 --retry-max-time 90 --max-filesize "$bytes" \
  --output "$package" "$url"
stage artifact-validation
test "$(wc -c < "$package")" -eq "$bytes"
printf '%s  %s\n' "$checksum" "$package" | sha256sum -c - >/dev/null
test "$(dpkg-deb -f "$package" Package)" = libnss3-tools
test "$(dpkg-deb -f "$package" Version)" = "$version"
test "$(dpkg-deb -f "$package" Architecture)" = "$architecture"
test "$(dpkg --print-architecture)" = "$architecture"
test "$(dpkg-deb -f "$package" Depends)" = "$dependencies"
check_dependency() {
  test "$(dpkg-query -W -f='${Status}' "$1")" = 'install ok installed'
  installed=$(dpkg-query -W -f='${Version}' "$1")
  dpkg --compare-versions "$installed" ge "$2"
}
# Four reviewed dependencies, not a resolver or a package-acquisition fallback.
check_dependency "$7" "$8"
check_dependency "$9" "${10}"
check_dependency "${11}" "${12}"
check_dependency "${13}" "${14}"
stage nss-tools
dpkg --install "$package" >/dev/null
command -v certutil >/dev/null
{
  grep -hE '^(URIs:|deb )' /etc/apt/sources.list.d/* | grep -Eo 'https?://[^ /]+' | sed -E 's#https?://##'
  printf '%s\n' "$url" | sed -E 's#https://([^/]+).*#\1#'
} | sort -u > /usr/local/share/daisy-launch-repositories.txt
dpkg-query -W -f='${binary:Package}\t${Version}\n' > /usr/local/share/daisy-launch-packages.txt
test ! -e /fixture/ca.crt
test ! -e /usr/local/share/ca-certificates/daisy-isolated-proof.crt
test ! -e /home/pwuser/.local/share/pki/nssdb
test ! -e /home/pwuser/.pki/nssdb
stage inventory
printf 'daisy-image-inventory:'
base64 -w0 /usr/local/share/daisy-launch-packages.txt
printf '\n'
