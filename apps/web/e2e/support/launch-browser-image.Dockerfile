ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG NSS_VERSION
# The complete apt operation is bounded even if its client disconnects. The
# explicit refresh identity on the build invalidates moving repository inputs.
RUN timeout --kill-after=5s 180s sh -ec '\
    apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 update -qq; \
    apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 install -y -qq --no-install-recommends "libnss3-tools=$NSS_VERSION"; \
    command -v certutil; \
    grep -hE "^(URIs:|deb )" /etc/apt/sources.list.d/* | grep -Eo "https?://[^ /]+" | sed -E "s#https?://##" | sort -u > /usr/local/share/daisy-launch-repositories.txt; \
    dpkg-query -W > /usr/local/share/daisy-launch-packages.txt; \
    rm -rf /var/lib/apt/lists/*'
