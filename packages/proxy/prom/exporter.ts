/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { diag } from "@opentelemetry/api";
import {
  Aggregation,
  AggregationTemporality,
  MetricReader,
} from "@opentelemetry/sdk-metrics";

import { Options, remoteWriteMetrics } from "./remote_write";

export class PrometheusRemoteWriteExporter extends MetricReader {
  private readonly options: Options;

  /**
   * Constructor
   * @param config Exporter configuration
   * @param callback Callback to be called after a server was started
   */
  constructor(options: Options) {
    super({
      aggregationSelector: (_instrumentType) => Aggregation.Default(),
      aggregationTemporalitySelector: (_instrumentType) =>
        AggregationTemporality.CUMULATIVE,
    });

    this.options = options;
  }

  override async onForceFlush(): Promise<void> {
    // This is the main entry point, since the exporter is called by the SDK
    const { resourceMetrics, errors } = await this.collect();
    if (errors.length > 0) {
      for (const error of errors) {
        diag.error("Error while exporting metrics", error);
      }
    }
    const resp = await remoteWriteMetrics(resourceMetrics, this.options);
    if (!resp.ok) {
      const error = Error(
        `Error while exporting metrics: ${resp.status} (${
          resp.statusText
        }): ${await resp.text()}`
      );
      console.log("Error while exporting metrics", error);
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
