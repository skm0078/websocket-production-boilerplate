/**
 * Metrics + HTTP surface tests.
 *
 * The Prometheus text format is a contract: scrapers parse it mechanically,
 * and a malformed exposition (non-cumulative buckets, missing +Inf, invented
 * TYPE lines) silently corrupts dashboards and alerting. Lock the format here.
 */
import http from "http";
import type { AddressInfo } from "net";
import express from "express";
import { Metrics } from "../src/logging/Metrics";
import { createHttpRouter } from "../src/server/prometheus";

describe("Metrics", () => {
  describe("Prometheus exposition", () => {
    it("exposes histogram observations as cumulative buckets ending in +Inf", () => {
      const metrics = new Metrics();
      metrics.observe("ws_message_processing_duration", 7);
      metrics.observe("ws_message_processing_duration", 60);
      metrics.observe("ws_message_processing_duration", 2000);
      const lines = metrics.toPrometheusText().split("\n");

      expect(lines).toContain("# TYPE ws_message_processing_duration histogram");
      expect(lines).toContain('ws_message_processing_duration_bucket{le="5"} 0');
      expect(lines).toContain('ws_message_processing_duration_bucket{le="10"} 1');
      expect(lines).toContain('ws_message_processing_duration_bucket{le="100"} 2');
      expect(lines).toContain('ws_message_processing_duration_bucket{le="+Inf"} 3');
      expect(lines).toContain("ws_message_processing_duration_sum 2067");
      expect(lines).toContain("ws_message_processing_duration_count 3");
    });

    it("emits one TYPE line per histogram family (no fake count/sum types)", () => {
      const metrics = new Metrics();
      metrics.observe("ws_message_processing_duration", 1);
      const text = metrics.toPrometheusText();
      expect(text).not.toContain("# TYPE ws_message_processing_duration_count");
      expect(text).not.toContain("# TYPE ws_message_processing_duration_sum");
    });

    it("emits zeroed buckets for an unobserved histogram", () => {
      const metrics = new Metrics();
      const text = metrics.toPrometheusText();
      expect(text).toContain('ws_message_processing_duration_bucket{le="+Inf"} 0');
      expect(text).toContain("ws_message_processing_duration_count 0");
    });

    it("emits counters and gauges with a single TYPE line", () => {
      const metrics = new Metrics();
      metrics.inc("ws_connections_total");
      metrics.setGauge("ws_connections_active", 3);
      const text = metrics.toPrometheusText();
      expect(text).toContain("# TYPE ws_connections_total counter");
      expect(text).toContain("ws_connections_total 1");
      expect(text).toContain("# TYPE ws_connections_active gauge");
      expect(text).toContain("ws_connections_active 3");
    });
  });
});

describe("createHttpRouter", () => {
  async function startServer(metricsEnabled?: boolean): Promise<{ baseUrl: string; server: http.Server }> {
    // Mirror production wiring (src/index.ts): router mounted on an express app.
    const app = express();
    app.use(createHttpRouter({ metricsEnabled }));
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    return { baseUrl: `http://127.0.0.1:${address.port}`, server };
  }

  it("serves /metrics by default", async () => {
    const { baseUrl, server } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/metrics`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");
      expect(await res.text()).toContain("# TYPE ws_connections_total counter");
    } finally {
      // closeAllConnections(): fetch's undici keep-alive socket would otherwise
      // hold the server open past close() and leak the worker (see 1.14).
      server.close();
      server.closeAllConnections();
    }
  });

  it("removes /metrics when metricsEnabled is false but keeps /health", async () => {
    const { baseUrl, server } = await startServer(false);
    try {
      const metricsRes = await fetch(`${baseUrl}/metrics`);
      expect(metricsRes.status).toBe(404);

      const healthRes = await fetch(`${baseUrl}/health`);
      expect(healthRes.status).toBe(200);
      expect((await healthRes.json()) as { status: string }).toMatchObject({ status: "ok" });
    } finally {
      // closeAllConnections(): fetch's undici keep-alive socket would otherwise
      // hold the server open past close() and leak the worker (see 1.14).
      server.close();
      server.closeAllConnections();
    }
  });
});