import { diag } from "@opentelemetry/api";
import {
  AggregationTemporality,
  MetricReader,
} from "@opentelemetry/sdk-metrics";

export class FlushingHttpMetricExporter extends MetricReader {
  private url: string;
  private headers: Record<string, string>;

  /**
   * Constructor
   * @param url The OTLP HTTP endpoint URL
   * @param headers Optional headers to send with requests
   */
  constructor(url: string, headers: Record<string, string> = {}) {
    super({
      aggregationTemporalitySelector: (_instrumentType) =>
        AggregationTemporality.DELTA,
    });

    this.url = url;
    this.headers = {
      "Content-Type": "application/json",
      ...headers,
    };
  }

  override async onForceFlush(): Promise<void> {
    // This is the main entry point, since the exporter is called by the SDK
    const { resourceMetrics, errors } = await this.collect();

    if (errors.length > 0) {
      for (const error of errors) {
        diag.error("Error while collecting metrics", error);
      }
    }

    if (resourceMetrics.scopeMetrics.length > 0) {
      try {
        // Format payload in proper OTLP format expected by Braintrust
        const otlpPayload = {
          resourceMetrics: [resourceMetrics],
        };

        console.log(JSON.stringify(otlpPayload, null, 2));
        const response = await fetch(this.url, {
          method: "POST",
          headers: this.headers,
          body: JSON.stringify(otlpPayload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `HTTP Export failed: ${response.status} (${response.statusText}): ${errorText}`,
          );
        } else {
          console.log(
            `Successfully exported metrics to ${this.url} with status ${response.status}`,
          );
        }
      } catch (error) {
        diag.error("Error while exporting metrics", error);
        throw error;
      }
    }
  }

  /**
   * Shuts down the export server and clears the registry
   */
  override async onShutdown(): Promise<void> {
    // nothing to do for HTTP exporter
  }
}
