# Grafana Cloud collection

The production Genesis-4 fleet runs on Ubuntu hosts. `standalone-host.alloy`
scrapes loopback-only Bloch validator metrics and the Alloy Unix exporter, then
remote-writes samples to Grafana Cloud. Supply credentials through the host's
`/etc/default/alloy`; never store them in Git.

The public `/observability` page reads only fixed aggregate PromQL through
`/api/v1/observability`. The Cloud token stays in the Pages Function secret.
Individual host labels, mountpoints, and arbitrary PromQL are not returned to
the browser. The page distinguishes missing samples from a measured zero.

The collector file lists the local metrics ports for one host. Adjust its
targets to match the validator services running on each host before installing
it. Check the Alloy config, restart Alloy, and confirm both `bloch_pos_*` and
`node_*` samples arrive in Grafana Cloud. A healthy `up` sample alone does not
prove that either metric family is present.

The Edgevana host formerly used for Genesis-3 AuxPoW now runs a single-node
K3s cluster for observability. Its Kubernetes API remains behind UFW and is
administered through an SSH tunnel. `k8s-monitoring-edgevana.values.yaml`
enables cluster metrics, cAdvisor and kube-state-metrics with one Alloy
DaemonSet. `install.sh` pins chart version 4.5.2 and injects the Grafana Cloud
token at runtime. The old `k8s-monitoring.values.yaml` records the full Grafana
PDF configuration, whose xlarge collectors and extra services are unsuitable
for this 2-vCPU, 8-GB host.

The public Observability page reads Kubernetes aggregate metrics from the same
Grafana Cloud Prometheus destination as the Genesis-4 host metrics.
