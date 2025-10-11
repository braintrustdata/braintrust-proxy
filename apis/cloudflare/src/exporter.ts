import { diag } from "@opentelemetry/api";
import {
  AggregationTemporality,
  MetricReader,
} from "@opentelemetry/sdk-metrics";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";

export class FlushingHttpMetricExporter extends MetricReader {
  private url: string;
  private headers: Record<string, string>;
  private otlpExporter: OTLPMetricExporter;

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

    // Create an OTLP exporter instance for serialization
    this.otlpExporter = new OTLPMetricExporter({
      url: url,
      headers: this.headers,
    });
  }

  override async onForceFlush(): Promise<void> {
    // This is the main entry point, since the exporter is called by the SDK
    const { resourceMetrics, errors } = await this.collect();

    if (errors.length > 0) {
      for (const error of errors) {
        diag.error("Error while collecting metrics", error);
      }
    }

    if (resourceMetrics.scopeMetrics.length === 0) {
      return;
    }

    try {
      // Use the official OTLP exporter to handle the export
      await new Promise<void>((resolve, reject) => {
        this.otlpExporter.export(resourceMetrics, (result) => {
          if (result.code === 0) {
            // SUCCESS
            resolve();
          } else {
            reject(
              new Error(
                `Export failed: ${result.error?.message || "Unknown error"}`,
              ),
            );
          }
        });
      });
    } catch (error) {
      diag.error("Error while exporting metrics", error);
    }
  }

  /**
   * Shuts down the export server and clears the registry
   */
  override async onShutdown(): Promise<void> {
    await this.otlpExporter.shutdown();
  }
}
