# Grafana Cloud collection

This installs the official `grafana/k8s-monitoring` chart and sends aggregate
Prometheus telemetry to the Grafana Cloud tenant read by `/api/v1/observability`.
The access token is never stored in Git or passed as a Helm command-line value.

Prerequisites:

- `kubectl config current-context` points at the intended production cluster;
- the selected identity can create resources in the `monitoring` namespace;
- `helm` 4.x and a compatible `kubectl` are available;
- the Bloch node exposes `/metrics` only on loopback or its pod network, never
  as an unauthenticated public service.

Read the token without echoing it and run the guarded installer:

```sh
export BLOCH_CLUSTER_NAME='the-real-cluster-name'
read -rs GRAFANA_CLOUD_TOKEN
export GRAFANA_CLOUD_TOKEN
deploy/grafana/install.sh
unset GRAFANA_CLOUD_TOKEN
```

The installer refuses to continue without a selected, reachable Kubernetes
context. It writes credentials to a mode-0600 temporary values file, removes
that file on exit, waits for the release, and verifies the Alloy deployment.

After samples arrive, the Explorer promotes the Observability link on its
front page automatically. Until then, the dedicated page remains explicit
about awaiting telemetry rather than rendering zeros.
