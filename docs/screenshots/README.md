# Screenshots — Manifest for OpenCode

> Screenshots are the **visual-first** evidence OpenCode uses when writing/polishing the blog.
> Capture each item, save as `docs/screenshots/screenshot-NN-<name>.png`, and tick it off.
> Captured evidence > claims. If a screenshot doesn't exist, the blog doesn't claim it.

## Capture checklist

| # | Screenshot | What it proves | Status |
|---|---|---|---|
| 01 | `screenshot-01-repo-tree.png` | The full repo tree (`tree /F`) | [x] |
| 02 | `screenshot-02-tests-passing.png` | `npm test` green output | [x] |
| 03 | `screenshot-03-typecheck-passing.png` | `npm run typecheck` green | [x] |
| 04 | `screenshot-04-docker-compose-up.png` | `docker compose up` — app + redis healthy | [x] |
| 05 | `screenshot-05-health-endpoint.png` | `curl http://localhost:8080/health` → `{"status":"ok"}` | [x] |
| 06 | `screenshot-06-metrics-endpoint.png` | `curl http://localhost:8080/metrics` → Prometheus text | [x] |
| 07 | `screenshot-07-wscat-connect.png` | `wscat -c "ws://localhost:8080?token=<token>"` connected | [x] |
| 08 | `screenshot-08-publish-subscribe.png` | Two clients: subscribe + publish + receive round-trip | [x] |
| 09 | `screenshot-09-reconnect-demo.png` | Client reconnects after server restart (backoff visible) | [x] |
| 10 | `screenshot-10-rate-limit-close.png` | Flooding → `4002` close with error envelope | [x] |
| 11 | `screenshot-11-auth-reject.png` | Bad token → `4001` close | [x] |
| 12 | `screenshot-12-browser-console.png` | Browser client session (heartbeats + messages in console) | [x] |

## Rules

- One screenshot, one claim. Name = what it shows.
- If it can't be captured (no Docker on this machine, etc.), mark `N/A` and say why — never fake it.
- OpenCode reads this manifest + the actual PNGs before writing the blog.
