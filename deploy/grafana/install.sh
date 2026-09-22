#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
set -euo pipefail

here="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
helm_bin="${HELM_BIN:-}"
kubectl_bin="${KUBECTL_BIN:-}"
if [[ -z "$helm_bin" ]]; then helm_bin="$(command -v helm 2>/dev/null || true)"; fi
if [[ -z "$helm_bin" && -x "$HOME/.local/bin/helm" ]]; then helm_bin="$HOME/.local/bin/helm"; fi
if [[ -z "$kubectl_bin" ]]; then kubectl_bin="$(command -v kubectl 2>/dev/null || true)"; fi
if [[ -z "$kubectl_bin" && -x "$HOME/.local/bin/kubectl" ]]; then kubectl_bin="$HOME/.local/bin/kubectl"; fi

BLOCH_CLUSTER_NAME="${BLOCH_CLUSTER_NAME:-edgevana-observability}"
: "${GRAFANA_CLOUD_TOKEN:?Set GRAFANA_CLOUD_TOKEN without placing it in shell history}"
[[ "$GRAFANA_CLOUD_TOKEN" != *$'\n'* ]] || { echo "The token must be one line" >&2; exit 1; }

[[ -x "$kubectl_bin" ]] || { echo "kubectl is required" >&2; exit 1; }
[[ -x "$helm_bin" ]] || { echo "helm is required" >&2; exit 1; }

context="$("$kubectl_bin" config current-context 2>/dev/null || true)"
if [[ -z "$context" ]]; then
  echo "No Kubernetes context is selected; refusing to install." >&2
  exit 1
fi
"$kubectl_bin" --request-timeout=8s get --raw=/readyz >/dev/null

secret_values="$(mktemp "${TMPDIR:-/tmp}/bloch-grafana-values.XXXXXX")"
chmod 600 "$secret_values"
trap 'rm -f -- "$secret_values"' EXIT HUP INT TERM
escaped_token="${GRAFANA_CLOUD_TOKEN//\'/\'\'}"
{
  printf '%s\n' 'destinations:' '  grafanaCloud:' '    auth:'
  printf "      password: '%s'\n" "$escaped_token"
} >"$secret_values"
unset GRAFANA_CLOUD_TOKEN escaped_token

echo "Installing Grafana Alloy into context: $context" >&2
"$helm_bin" repo add grafana https://grafana.github.io/helm-charts --force-update
"$helm_bin" repo update grafana
"$helm_bin" upgrade --install grafana-cloud grafana/k8s-monitoring \
  --version 4.5.2 \
  --namespace monitoring --create-namespace \
  --set-string "cluster.name=$BLOCH_CLUSTER_NAME" \
  --values "$here/k8s-monitoring-edgevana.values.yaml" \
  --values "$secret_values" \
  --wait --timeout 15m

"$kubectl_bin" --namespace monitoring get pods
