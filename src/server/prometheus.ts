/**
 * HTTP surface: /health for orchestrators, /metrics for Prometheus.
 * Kept on the same server as the WS upgrade — one port, one container.
 */
import { Router } from "express";
import { metrics } from "../logging/Metrics";

export interface HttpRouterOptions {
  /** Wire METRICS_ENABLED: false removes the /metrics route entirely. */
  metricsEnabled?: boolean;
}

export function createHttpRouter(options: HttpRouterOptions = {}): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ status: "ok", uptimeSeconds: Math.round(process.uptime()) });
  });

  if (options.metricsEnabled !== false) {
    router.get("/metrics", (_req, res) => {
      res.set("Content-Type", "text/plain; version=0.0.4");
      res.send(metrics.toPrometheusText());
    });
  }

  return router;
}
