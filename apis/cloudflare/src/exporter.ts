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
import { ExportResult, ExportResultCode } from "@opentelemetry/core";
import {
  AggregationTemporality,
  AggregationTemporalitySelector,
  InstrumentType,
  PushMetricExporter,
  ResourceMetrics,
} from "@opentelemetry/sdk-metrics";
import { DEFAULT_AGGREGATION_TEMPORALITY_SELECTOR } from "@opentelemetry/sdk-metrics/build/src/export/AggregationSelector";

interface ConsoleMetricExporterOptions {
  temporalitySelector?: AggregationTemporalitySelector;
}

/* eslint-disable no-console */
export class ConsoleMetricExporter implements PushMetricExporter {
  protected _shutdown = false;
  protected _temporalitySelector: AggregationTemporalitySelector;

  constructor(options?: ConsoleMetricExporterOptions) {
    this._temporalitySelector =
      options?.temporalitySelector ?? DEFAULT_AGGREGATION_TEMPORALITY_SELECTOR;
  }

  export(
    metrics: ResourceMetrics,
    resultCallback: (result: ExportResult) => void
  ): void {
    if (this._shutdown) {
      // If the exporter is shutting down, by spec, we need to return FAILED as export result
      setImmediate(resultCallback, { code: ExportResultCode.FAILED });
      return;
    }

    return ConsoleMetricExporter._sendMetrics(metrics, resultCallback);
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  selectAggregationTemporality(
    _instrumentType: InstrumentType
  ): AggregationTemporality {
    return this._temporalitySelector(_instrumentType);
  }

  shutdown(): Promise<void> {
    this._shutdown = true;
    return Promise.resolve();
  }

  private static _sendMetrics(
    metrics: ResourceMetrics,
    done: (result: ExportResult) => void
  ): void {
    console.log("SEND???", metrics.scopeMetrics);
    for (const scopeMetrics of metrics.scopeMetrics) {
      for (const metric of scopeMetrics.metrics) {
        console.log("METRIC?", metric);
        console.dir({
          descriptor: metric.descriptor,
          dataPointType: metric.dataPointType,
          dataPoints: metric.dataPoints,
        });
      }
    }

    done({ code: ExportResultCode.SUCCESS });
  }
}
