# Prometheus Serializer

This package contains a serializer for [Prometheus](https://prometheus.io/) metrics and
support for publishing them via the [`remote_write`](https://prometheus.io/docs/prometheus/latest/configuration/configuration/#remote_write) protocol.

Much of the code is forked from the [prometheus-remote-write](https://github.com/huksley/prometheus-remote-write)
package, but has been modified to use vanilla `fetch` and upgraded to TypeScript.
