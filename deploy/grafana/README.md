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

`k8s-monitoring.values.yaml` and `install.sh` are retained for a future
Kubernetes deployment. They are not part of the current Ubuntu collection
path.
