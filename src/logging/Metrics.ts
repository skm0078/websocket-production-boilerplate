/**
 * Minimal Prometheus-style metrics: counters, gauges, histograms.
 * Export via GET /metrics in Prometheus text format (see server/prometheus.ts).
 *
 * Alert on the canaries, not on CPU:
 *   - ws_messages_dropped_total  (queue/close drops)
 *   - ws_errors_total            (protocol + app errors)
 *   - ws_connections_active      (saturation)
 */

type Metric =
  | { type: "counter"; value: number }
  | { type: "gauge"; value: number }
  | {
      type: "histogram";
      /** Per-bucket observation counts, keyed by bucket index (0..HISTOGRAM_BOUNDS.length). */
      buckets: Record<number, number>;
      count: number;
      sum: number;
    };

const HISTOGRAM_BOUNDS = [5, 10, 25, 50, 100, 250, 500, 1000];

export class Metrics {
  private readonly metrics = new Map<string, Metric>();

  constructor() {
    this.register("ws_connections_total", { type: "counter", value: 0 });
    this.register("ws_connections_active", { type: "gauge", value: 0 });
    this.register("ws_messages_received_total", { type: "counter", value: 0 });
    this.register("ws_messages_sent_total", { type: "counter", value: 0 });
    this.register("ws_messages_dropped_total", { type: "counter", value: 0 });
    this.register("ws_errors_total", { type: "counter", value: 0 });
    this.register("ws_message_processing_duration", {
      type: "histogram",
      buckets: {},
      count: 0,
      sum: 0
    });
  }

  private register(name: string, metric: Metric): void {
    this.metrics.set(name, metric);
  }

  inc(name: string, by = 1): void {
    const metric = this.metrics.get(name);
    if (metric && metric.type === "counter") metric.value += by;
  }

  setGauge(name: string, value: number): void {
    const metric = this.metrics.get(name);
    if (metric && metric.type === "gauge") metric.value = value;
  }

  observe(name: string, valueMs: number): void {
    const metric = this.metrics.get(name);
    if (metric && metric.type === "histogram") {
      metric.sum += valueMs;
      metric.count += 1;
      // Smallest bound that covers the value; everything above the largest
      // bound lands in the +Inf bucket (index HISTOGRAM_BOUNDS.length).
      let bucketIndex = HISTOGRAM_BOUNDS.length;
      for (let i = 0; i < HISTOGRAM_BOUNDS.length; i += 1) {
        if (valueMs <= HISTOGRAM_BOUNDS[i]) {
          bucketIndex = i;
          break;
        }
      }
      metric.buckets[bucketIndex] = (metric.buckets[bucketIndex] ?? 0) + 1;
    }
  }

  toPrometheusText(): string {
    const lines: string[] = [];
    for (const [name, metric] of this.metrics) {
      if (metric.type === "histogram") {
        // Prometheus histogram exposition: one TYPE line, cumulative le
        // buckets (each includes all observations <= le), a +Inf bucket
        // equal to the total count, then sum/count for the same family.
        // Per-bucket counts are non-cumulative internally; cumulative totals
        // are computed at export time.
        lines.push(`# TYPE ${name} histogram`);
        let cumulative = 0;
        for (let i = 0; i < HISTOGRAM_BOUNDS.length; i += 1) {
          cumulative += metric.buckets[i] ?? 0;
          lines.push(`${name}_bucket{le="${HISTOGRAM_BOUNDS[i]}"} ${cumulative}`);
        }
        cumulative += metric.buckets[HISTOGRAM_BOUNDS.length] ?? 0;
        lines.push(`${name}_bucket{le="+Inf"} ${cumulative}`);
        lines.push(`${name}_sum ${metric.sum}`);
        lines.push(`${name}_count ${metric.count}`);
      } else {
        lines.push(`# TYPE ${name} ${metric.type}`);
        lines.push(`${name} ${metric.value}`);
      }
    }
    return lines.join("\n");
  }
}

/** Process-wide metrics registry; consumed by GET /metrics. */
export const metrics = new Metrics();
