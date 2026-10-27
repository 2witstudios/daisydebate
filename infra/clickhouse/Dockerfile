# The operational log store (ADR 0081): ClickHouse with Daisy's server
# config, users and versioned schema baked in. Fly builds it from
# fly.clickhouse.toml; the local stack and CI build the same file from
# infra/compose.yaml. LTS line 26.8, pinned by digest.
FROM clickhouse/clickhouse-server:26.8.36.3@sha256:d426d2f612e1e189c90f9a3f8dcd85a03c6851273833817a296bb327e63aa7a7
# The image's own docker config listens on every interface for every
# protocol; ours replaces it (HTTP and native only, no MySQL or PostgreSQL
# wire, no interserver port).
RUN rm -f /etc/clickhouse-server/config.d/docker_related_config.xml
COPY infra/clickhouse/config.d/ /etc/clickhouse-server/config.d/
COPY infra/clickhouse/users.d/ /etc/clickhouse-server/users.d/
COPY infra/clickhouse/migrations/ /daisy/migrations/
COPY --chmod=0755 infra/clickhouse/entrypoint.sh /daisy/entrypoint.sh
# 6PN on Fly; compose overrides it for the local and CI stack.
ENV CLICKHOUSE_CLIENT_NETWORK=fdaa::/16
EXPOSE 8123
ENTRYPOINT ["/daisy/entrypoint.sh"]
