import { diag } from "@opentelemetry/api";
import {
  AggregationTemporality,
  MetricReader,
} from "@opentelemetry/sdk-metrics";

export class FlushingExporter extends MetricReader {
  /**
   * Constructor
   * @param config Exporter configuration
   * @param callback Callback to be called after a server was started
   */
  constructor(private flushFn: (resourceMetrics: any) => Promise<Response>) {
    super({
      aggregationTemporalitySelector: (_instrumentType) =>
        AggregationTemporality.CUMULATIVE,
    });
  }

  override async onForceFlush(): Promise<void> {
    // This is the main entry point, since the exporter is called by the SDK
    const { resourceMetrics, errors } = await this.collect();
    if (errors.length > 0) {
      for (const error of errors) {
        diag.error("Error while exporting metrics", error);
      }
    }
    const resp = await this.flushFn({ resourceMetrics, errors });

    if (!resp.ok) {
      const error = Error(
        `Error while flushing metrics: ${resp.status} (${
          resp.statusText
        }): ${await resp.text()}`,
      );
      console.log("Error while flushing metrics", error);
      throw error;
    }
  }

  /**
   * Shuts down the export server and clears the registry
   */
  override async onShutdown(): Promise<void> {
    // do nothing
  }
}
