# Observability

Darkbeacon can send **traces, metrics and logs** over OpenTelemetry (OTLP) to Grafana (Tempo, Loki,
Prometheus/Mimir), Grafana Cloud or any OTLP collector, and serve **Prometheus metrics** at `/metrics`. Both
are off by default and configured with environment variables only; while they are off the OpenTelemetry SDK
is not even loaded.

- [Turn it on](#turn-it-on)
- [Grafana all-in-one (`grafana/otel-lgtm`)](#grafana-all-in-one-grafanaotel-lgtm)
- [Grafana Cloud](#grafana-cloud)
- [Any OTLP collector](#any-otlp-collector)
- [Prometheus scrape at `/metrics`](#prometheus-scrape-at-metrics)
- [Environment variables](#environment-variables)
- [What is exported](#what-is-exported)
- [Health and readiness](#health-and-readiness)
- [How it works](#how-it-works)

## Turn it on

Set an OTLP endpoint. That is all:

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318
```

Traces, metrics and logs then go to `<endpoint>/v1/traces`, `/v1/metrics` and `/v1/logs` over HTTP
(protobuf). `OTEL_ENABLED=true` turns it on without an endpoint (a collector at `localhost:4318`),
`OTEL_ENABLED=false` keeps it off even with one, and the standard `OTEL_SDK_DISABLED=true` switches all of it
off. Admin > Instance > **Observability** shows what is running: on or off, the endpoint's host (never its
path, headers or tokens), protocol, signals, service name and whether `/metrics` is served.

Settings that cannot work (an unknown protocol, `/metrics` without a token...) stop the server at start with
the list of problems, like any other configuration error.

## Grafana all-in-one (`grafana/otel-lgtm`)

[`grafana/otel-lgtm`](https://github.com/grafana/docker-otel-lgtm) is an OTLP collector, Tempo, Loki,
Prometheus and Grafana in one container, made for trying things out. `docker-compose.observability.yml` runs
it next to a demo instance and provisions the starter dashboard
([`docs/grafana/darkbeacon-dashboard.json`](grafana/darkbeacon-dashboard.json)):

```sh
docker compose -f docker-compose.observability.yml up -d --build
docker compose -f docker-compose.observability.yml port darkbeacon 3000   # Darkbeacon
docker compose -f docker-compose.observability.yml port lgtm 3000         # Grafana, no login
```

Open a few maps, then in Grafana: **Dashboards > Darkbeacon** for the metrics, **Explore > Tempo** for traces
(search `service.name = darkbeacon`), **Explore > Loki** for logs (`{service_name="darkbeacon"}`). A page view
is one trace across both processes: the API server's request, its hop to the web app's server, the server
render and every API call it made, down to the SQL statements. Log lines carry `trace_id` and `span_id`, so
Grafana links a log line to its trace.

With your own instance, the same two variables do it:

```sh
docker run -d --name lgtm -p 127.0.0.1::3000 --network darkbeacon grafana/otel-lgtm:0.36.0
docker run ... --network darkbeacon -e OTEL_EXPORTER_OTLP_ENDPOINT=http://lgtm:4318 darkbeacon
```

## Grafana Cloud

Grafana Cloud takes OTLP at its gateway with basic auth. In the Grafana Cloud portal, open your stack,
**OpenTelemetry > Configure**: it shows the endpoint, the instance id and creates a token. Then:

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-eu-west-2.grafana.net/otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
# "Basic " + base64("<instance id>:<token>"); the space after Basic is written %20.
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic%20MTIzNDU2Om...
OTEL_SERVICE_NAME=darkbeacon
OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=production
```

```sh
printf '%s' '123456:glc_...' | base64 | tr -d '\n'    # the value after "Basic%20"
```

Traces land in Tempo, metrics in Mimir (Prometheus), logs in Loki. Import
[`docs/grafana/darkbeacon-dashboard.json`](grafana/darkbeacon-dashboard.json) (Dashboards > New > Import) and
pick the stack's Prometheus data source.

## Any OTLP collector

The exporters follow the OpenTelemetry specification, so anything that speaks OTLP works: the OpenTelemetry
Collector, Grafana Alloy, Jaeger, Honeycomb, Datadog, SigNoz... gRPC instead of HTTP:

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4317
OTEL_EXPORTER_OTLP_PROTOCOL=grpc
```

Per signal: `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` (used as is, path included), `..._METRICS_...`,
`..._LOGS_...`, the same for `_PROTOCOL` and `_HEADERS`, and `OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER`,
`OTEL_LOGS_EXPORTER` (`otlp`, `console` or `none`) to send only some signals. Sampling is the standard
`OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG`, for example `parentbased_traceidratio` and `0.1` to keep
one trace in ten on a busy instance.

## Prometheus scrape at `/metrics`

Prometheus (or Alloy, VictoriaMetrics, ...) can pull the same metrics instead of receiving them:

```sh
METRICS_PROMETHEUS=true
METRICS_TOKEN=$(openssl rand -hex 32)
```

`/metrics` is served on the instance's own port and answers only requests with
`Authorization: Bearer <METRICS_TOKEN>` (401 otherwise), so it is never open to the internet by accident. A
token is required: without one the server does not start. It works on its own (no OTLP endpoint needed) or
alongside OTLP export. `OTEL_METRICS_EXPORTER=prometheus` does the same as `METRICS_PROMETHEUS=true`.

```yaml
# prometheus.yml
scrape_configs:
  - job_name: darkbeacon
    scheme: https # http when Prometheus reaches the container directly
    metrics_path: /metrics
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/darkbeacon-token # or credentials: '<METRICS_TOKEN>'
    static_configs:
      - targets: ['map.example.org']
```

```sh
curl -H "Authorization: Bearer $METRICS_TOKEN" https://map.example.org/metrics
```

Metric names in the scrape have no unit suffix (`darkbeacon_tracking_poll_duration_bucket`); through OTLP,
Prometheus and Mimir add it (`darkbeacon_tracking_poll_duration_seconds_bucket`). The starter dashboard
accepts both.

## Environment variables

| Variable                                                               | Default                 |                                                                       |
| ---------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                                          |                         | Base URL of the OTLP receiver; setting it turns export on             |
| `OTEL_ENABLED`                                                         |                         | `true`: export without an endpoint (localhost); `false`: never export |
| `OTEL_SDK_DISABLED`                                                    | `false`                 | `true` switches all telemetry off, `/metrics` included                |
| `OTEL_EXPORTER_OTLP_PROTOCOL`                                          | `http/protobuf`         | or `http/json`, `grpc`                                                |
| `OTEL_EXPORTER_OTLP_HEADERS`                                           |                         | `key=value,...` (values URL-encoded), e.g. the `Authorization` header |
| `OTEL_EXPORTER_OTLP_{TRACES,METRICS,LOGS}_{ENDPOINT,PROTOCOL,HEADERS}` |                         | Per signal                                                            |
| `OTEL_EXPORTER_OTLP_TIMEOUT`, `_COMPRESSION`, `_CERTIFICATE`...        |                         | As in the specification                                               |
| `OTEL_SERVICE_NAME`                                                    | `darkbeacon`            | The web app's server reports as `<name>-web`                          |
| `OTEL_RESOURCE_ATTRIBUTES`                                             |                         | e.g. `deployment.environment.name=prod,service.namespace=eve`         |
| `OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER`  | `otlp`                  | `otlp`, `console`, `none` (metrics also `prometheus`)                 |
| `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG`                       | `parentbased_always_on` | Standard samplers                                                     |
| `OTEL_METRIC_EXPORT_INTERVAL`                                          | `60000`                 | How often metrics are pushed (ms)                                     |
| `OTEL_LOG_LEVEL`                                                       |                         | `debug` prints what the SDK does (export errors and the like)         |
| `METRICS_PROMETHEUS`                                                   | `false`                 | Serve `/metrics`                                                      |
| `METRICS_TOKEN`                                                        |                         | Bearer token for `/metrics`, at least 16 characters; required with it |

## What is exported

**Traces.** HTTP in and out (`@opentelemetry/instrumentation-http`), `fetch` (ESI, Discord, EVE SSO and the
web app's calls to the API, through `instrumentation-undici`), Fastify's request lifecycle (`@fastify/otel`),
Nest controllers (`instrumentation-nestjs-core`), Postgres queries (`instrumentation-pg`) and SQLite queries
(spans around Kysely's driver, as better-sqlite3 has no maintained instrumentation), realtime subscriptions
(`ws subscribe`, `ws catch-up`), and in the web app's server what Next.js reports (rendering, its fetches).
Database spans exist only inside something that is traced, not for the background polls. Health checks and
`/metrics` are not traced.

**Metrics** (OTel names; Prometheus replaces dots with underscores and counters end in `_total`). Attributes
never carry character, account or map ids.

| Metric                                                         | Type                                                          | Attributes                                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `darkbeacon.events.appended`                                   | counter                                                       | `event.type`                                                                              |
| `darkbeacon.event_consumer.lag`                                | gauge: events a durable consumer (outbox) still has to handle | `consumer`                                                                                |
| `darkbeacon.notifications.deliveries`                          | counter                                                       | `channel` (`webhook`, `discord`), `outcome` (`ok`, `failed`)                              |
| `darkbeacon.esi.requests`                                      | counter                                                       | `esi.route` (template), `http.request.method`, `http.response.status_code` (0: no answer) |
| `darkbeacon.esi.errors`                                        | counter                                                       | `esi.route`, `error.type` (status or network error code)                                  |
| `darkbeacon.esi.request.duration`                              | histogram, s                                                  | `esi.route`                                                                               |
| `darkbeacon.esi.error_limit.remaining`                         | gauge (`X-ESI-Error-Limit-Remain`)                            |                                                                                           |
| `darkbeacon.esi.rate_limit.remaining`                          | gauge (`X-Ratelimit-Remaining`)                               | `esi.rate_limit.group`                                                                    |
| `darkbeacon.tracking.poll.duration`                            | histogram, s                                                  |                                                                                           |
| `darkbeacon.zkill.requests`                                    | counter                                                       | `endpoint` (`r2z2`, `api`), `outcome` (`2xx`...`5xx`, `403`, `404`, `429`, `error`)       |
| `darkbeacon.intel.kills`                                       | counter: killmails stored for systems on maps                 | `source` (`feed`, `history`)                                                              |
| `darkbeacon.characters.online`                                 | gauge                                                         |                                                                                           |
| `darkbeacon.maps`                                              | gauge                                                         |                                                                                           |
| `darkbeacon.realtime.connections`                              | gauge: open WebSockets                                        |                                                                                           |
| `http.server.request.duration`, `http.client.request.duration` | histograms from the HTTP instrumentations                     | `http.route`, `http.response.status_code`...                                              |
| `nodejs.eventloop.*`, `v8js.*`                                 | Node.js runtime (`instrumentation-runtime-node`)              |                                                                                           |

**Logs.** Every line the server logs (its own, the plugins', and the web app's server output) is also an
OpenTelemetry log record with its severity, `logger.name` (the context, e.g. `Webhooks`) and, when it
happened during a traced request, `trace_id` and `span_id`. The console output stays as it was.

## Health and readiness

- `GET /api/health`: the process answers, the database answers and the web app's server answers (503
  otherwise). The image's `HEALTHCHECK` uses it.
- `GET /api/ready`: the database answers and every migration is applied (503 otherwise), for orchestrators
  that hold traffic until an instance is ready.

## How it works

- The image starts node with `--import ./apps/server/dist/adapters/observability/preload.js`. The preload
  reads the settings and, only when telemetry is on, imports the SDK and registers the instrumentations
  before the application is loaded (ESM imports are hooked with `import-in-the-middle`). Running
  `node apps/server/dist/main.js` without it logs a warning and the admin card says "Configured, but not
  running".
- The API server starts the web app's server with `OTEL_SERVICE_NAME=<name>-web` and traces only; Next.js
  registers OpenTelemetry from `apps/web/src/instrumentation.ts`. The proxy hop from the API server to the
  web app's server and the web app's calls back to the API carry W3C `traceparent` headers.
- The module is `packages/modules/observability` (settings, metric names and attributes, the admin status)
  with the SDK behind ports in `apps/server/src/adapters/observability`; other modules take its
  `DomainTelemetry` as an optional dependency, so the module can be left out without touching them.
