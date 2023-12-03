import * as $protobuf from "protobufjs";
import Long = require("long");
/** Namespace prometheus. */
export namespace prometheus {

    /** Properties of a MetricMetadata. */
    interface IMetricMetadata {

        /** MetricMetadata type */
        type?: (prometheus.MetricMetadata.MetricType|null);

        /** MetricMetadata metricFamilyName */
        metricFamilyName?: (string|null);

        /** MetricMetadata help */
        help?: (string|null);

        /** MetricMetadata unit */
        unit?: (string|null);
    }

    /** Represents a MetricMetadata. */
    class MetricMetadata implements IMetricMetadata {

        /**
         * Constructs a new MetricMetadata.
         * @param [properties] Properties to set
         */
        constructor(properties?: prometheus.IMetricMetadata);

        /** MetricMetadata type. */
        public type: prometheus.MetricMetadata.MetricType;

        /** MetricMetadata metricFamilyName. */
        public metricFamilyName: string;

        /** MetricMetadata help. */
        public help: string;

        /** MetricMetadata unit. */
        public unit: string;

        /**
         * Creates a new MetricMetadata instance using the specified properties.
         * @param [properties] Properties to set
         * @returns MetricMetadata instance
         */
        public static create(properties?: prometheus.IMetricMetadata): prometheus.MetricMetadata;

        /**
         * Encodes the specified MetricMetadata message. Does not implicitly {@link prometheus.MetricMetadata.verify|verify} messages.
         * @param message MetricMetadata message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: prometheus.IMetricMetadata, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified MetricMetadata message, length delimited. Does not implicitly {@link prometheus.MetricMetadata.verify|verify} messages.
         * @param message MetricMetadata message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: prometheus.IMetricMetadata, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a MetricMetadata message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns MetricMetadata
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): prometheus.MetricMetadata;

        /**
         * Decodes a MetricMetadata message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns MetricMetadata
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): prometheus.MetricMetadata;

        /**
         * Verifies a MetricMetadata message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a MetricMetadata message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns MetricMetadata
         */
        public static fromObject(object: { [k: string]: any }): prometheus.MetricMetadata;

        /**
         * Creates a plain object from a MetricMetadata message. Also converts values to other types if specified.
         * @param message MetricMetadata
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: prometheus.MetricMetadata, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this MetricMetadata to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for MetricMetadata
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    namespace MetricMetadata {

        /** MetricType enum. */
        enum MetricType {
            UNKNOWN = 0,
            COUNTER = 1,
            GAUGE = 2,
            HISTOGRAM = 3,
            GAUGEHISTOGRAM = 4,
            SUMMARY = 5,
            INFO = 6,
            STATESET = 7
        }
    }

    /** Properties of a Sample. */
    interface ISample {

        /** Sample value */
        value?: (number|null);

        /** Sample timestamp */
        timestamp?: (number|Long|null);
    }

    /** Represents a Sample. */
    class Sample implements ISample {

        /**
         * Constructs a new Sample.
         * @param [properties] Properties to set
         */
        constructor(properties?: prometheus.ISample);

        /** Sample value. */
        public value: number;

        /** Sample timestamp. */
        public timestamp: (number|Long);

        /**
         * Creates a new Sample instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Sample instance
         */
        public static create(properties?: prometheus.ISample): prometheus.Sample;

        /**
         * Encodes the specified Sample message. Does not implicitly {@link prometheus.Sample.verify|verify} messages.
         * @param message Sample message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: prometheus.ISample, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Sample message, length delimited. Does not implicitly {@link prometheus.Sample.verify|verify} messages.
         * @param message Sample message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: prometheus.ISample, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Sample message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Sample
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): prometheus.Sample;

        /**
         * Decodes a Sample message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Sample
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): prometheus.Sample;

        /**
         * Verifies a Sample message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Sample message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Sample
         */
        public static fromObject(object: { [k: string]: any }): prometheus.Sample;

        /**
         * Creates a plain object from a Sample message. Also converts values to other types if specified.
         * @param message Sample
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: prometheus.Sample, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Sample to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Sample
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an Exemplar. */
    interface IExemplar {

        /** Exemplar labels */
        labels?: (prometheus.ILabel[]|null);

        /** Exemplar value */
        value?: (number|null);

        /** Exemplar timestamp */
        timestamp?: (number|Long|null);
    }

    /** Represents an Exemplar. */
    class Exemplar implements IExemplar {

        /**
         * Constructs a new Exemplar.
         * @param [properties] Properties to set
         */
        constructor(properties?: prometheus.IExemplar);

        /** Exemplar labels. */
        public labels: prometheus.ILabel[];

        /** Exemplar value. */
        public value: number;

        /** Exemplar timestamp. */
        public timestamp: (number|Long);

        /**
         * Creates a new Exemplar instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Exemplar instance
         */
        public static create(properties?: prometheus.IExemplar): prometheus.Exemplar;

        /**
         * Encodes the specified Exemplar message. Does not implicitly {@link prometheus.Exemplar.verify|verify} messages.
         * @param message Exemplar message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: prometheus.IExemplar, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Exemplar message, length delimited. Does not implicitly {@link prometheus.Exemplar.verify|verify} messages.
         * @param message Exemplar message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: prometheus.IExemplar, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an Exemplar message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Exemplar
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): prometheus.Exemplar;

        /**
         * Decodes an Exemplar message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Exemplar
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): prometheus.Exemplar;

        /**
         * Verifies an Exemplar message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an Exemplar message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Exemplar
         */
        public static fromObject(object: { [k: string]: any }): prometheus.Exemplar;

        /**
         * Creates a plain object from an Exemplar message. Also converts values to other types if specified.
         * @param message Exemplar
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: prometheus.Exemplar, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Exemplar to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Exemplar
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a TimeSeries. */
    interface ITimeSeries {

        /** TimeSeries labels */
        labels?: (prometheus.ILabel[]|null);

        /** TimeSeries samples */
        samples?: (prometheus.ISample[]|null);

        /** TimeSeries exemplars */
        exemplars?: (prometheus.IExemplar[]|null);
    }

    /** Represents a TimeSeries. */
    class TimeSeries implements ITimeSeries {

        /**
         * Constructs a new TimeSeries.
         * @param [properties] Properties to set
         */
        constructor(properties?: prometheus.ITimeSeries);

        /** TimeSeries labels. */
        public labels: prometheus.ILabel[];

        /** TimeSeries samples. */
        public samples: prometheus.ISample[];

        /** TimeSeries exemplars. */
        public exemplars: prometheus.IExemplar[];

        /**
         * Creates a new TimeSeries instance using the specified properties.
         * @param [properties] Properties to set
         * @returns TimeSeries instance
         */
        public static create(properties?: prometheus.ITimeSeries): prometheus.TimeSeries;

        /**
         * Encodes the specified TimeSeries message. Does not implicitly {@link prometheus.TimeSeries.verify|verify} messages.
         * @param message TimeSeries message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: prometheus.ITimeSeries, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified TimeSeries message, length delimited. Does not implicitly {@link prometheus.TimeSeries.verify|verify} messages.
         * @param message TimeSeries message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: prometheus.ITimeSeries, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a TimeSeries message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns TimeSeries
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): prometheus.TimeSeries;

        /**
         * Decodes a TimeSeries message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns TimeSeries
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): prometheus.TimeSeries;

        /**
         * Verifies a TimeSeries message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a TimeSeries message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns TimeSeries
         */
        public static fromObject(object: { [k: string]: any }): prometheus.TimeSeries;

        /**
         * Creates a plain object from a TimeSeries message. Also converts values to other types if specified.
         * @param message TimeSeries
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: prometheus.TimeSeries, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this TimeSeries to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for TimeSeries
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a Label. */
    interface ILabel {

        /** Label name */
        name?: (string|null);

        /** Label value */
        value?: (string|null);
    }

    /** Represents a Label. */
    class Label implements ILabel {

        /**
         * Constructs a new Label.
         * @param [properties] Properties to set
         */
        constructor(properties?: prometheus.ILabel);

        /** Label name. */
        public name: string;

        /** Label value. */
        public value: string;

        /**
         * Creates a new Label instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Label instance
         */
        public static create(properties?: prometheus.ILabel): prometheus.Label;

        /**
         * Encodes the specified Label message. Does not implicitly {@link prometheus.Label.verify|verify} messages.
         * @param message Label message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: prometheus.ILabel, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Label message, length delimited. Does not implicitly {@link prometheus.Label.verify|verify} messages.
         * @param message Label message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: prometheus.ILabel, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Label message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Label
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): prometheus.Label;

        /**
         * Decodes a Label message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Label
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): prometheus.Label;

        /**
         * Verifies a Label message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Label message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Label
         */
        public static fromObject(object: { [k: string]: any }): prometheus.Label;

        /**
         * Creates a plain object from a Label message. Also converts values to other types if specified.
         * @param message Label
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: prometheus.Label, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Label to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Label
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a WriteRequest. */
    interface IWriteRequest {

        /** WriteRequest timeseries */
        timeseries?: (prometheus.ITimeSeries[]|null);

        /** WriteRequest metadata */
        metadata?: (prometheus.IMetricMetadata[]|null);
    }

    /** Represents a WriteRequest. */
    class WriteRequest implements IWriteRequest {

        /**
         * Constructs a new WriteRequest.
         * @param [properties] Properties to set
         */
        constructor(properties?: prometheus.IWriteRequest);

        /** WriteRequest timeseries. */
        public timeseries: prometheus.ITimeSeries[];

        /** WriteRequest metadata. */
        public metadata: prometheus.IMetricMetadata[];

        /**
         * Creates a new WriteRequest instance using the specified properties.
         * @param [properties] Properties to set
         * @returns WriteRequest instance
         */
        public static create(properties?: prometheus.IWriteRequest): prometheus.WriteRequest;

        /**
         * Encodes the specified WriteRequest message. Does not implicitly {@link prometheus.WriteRequest.verify|verify} messages.
         * @param message WriteRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: prometheus.IWriteRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified WriteRequest message, length delimited. Does not implicitly {@link prometheus.WriteRequest.verify|verify} messages.
         * @param message WriteRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: prometheus.IWriteRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a WriteRequest message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns WriteRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): prometheus.WriteRequest;

        /**
         * Decodes a WriteRequest message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns WriteRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): prometheus.WriteRequest;

        /**
         * Verifies a WriteRequest message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a WriteRequest message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns WriteRequest
         */
        public static fromObject(object: { [k: string]: any }): prometheus.WriteRequest;

        /**
         * Creates a plain object from a WriteRequest message. Also converts values to other types if specified.
         * @param message WriteRequest
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: prometheus.WriteRequest, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this WriteRequest to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for WriteRequest
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }
}
