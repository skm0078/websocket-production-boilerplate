# Screenshots — visual evidence

> **Captured evidence > claims. If a screenshot doesn't exist, the blog doesn't
> claim it.**

That rule was in this file from the start. It was not followed, and this README
is the correction.

## What happened

The ten PNGs previously in this directory were **not screenshots of anything**.
`capture-screenshots.js` held ten hand-written HTML strings styled to look like a
terminal, rendered them with `page.setContent()`, and screenshotted the result.
No command was ever run to produce them.

The checklist below used to have all ten ticked `[x]`.

The test-count ones were at least accurate. The others were not merely decorative
— they asserted behaviour that was never observed:

- `rate-limit-close-4002.png` — claimed a rate limiter fired and closed with 4002
- `auth-reject-4001.png` — claimed an invalid token was rejected with 4001
- `client-reconnect-backoff.png` — claimed backoff at 1s, 2s, 4s
- `metrics-endpoint.png` — claimed specific Prometheus counter values
- `browser-client-session.png` — claimed a session with timestamps at `[10:30:01]`

They have been deleted rather than kept, and `capture-screenshots.js` is gone.
Nothing was ever published from them.

## What is real, and stays

| File | Status |
|---|---|
| `screenshot-02-tests-passing.txt` | **Real** `npm test` output |
| `screenshot-03-typecheck-passing.txt` | **Real** `npm run typecheck` output |

The genuine output existed the whole time. It was captured, then set aside in
favour of a prettier fabrication. That is the actual failure worth remembering:
not an inability to capture, but nothing forcing the real artifact to be the one
that got used.

## Capture checklist — all pending

Nothing here is ticked until a real run produces it.

| # | Evidence | What it proves | Status |
|---|---|---|---|
| 01 | `npm test` | Suite passes, with the real count and timing | [ ] |
| 02 | `npm run typecheck` | Strict TS compiles clean | [ ] |
| 03 | `docker compose up -d --build` + `ps` | App and Redis actually start | [ ] |
| 04 | `curl /health` | Health endpoint responds | [ ] |
| 05 | `curl /metrics` | Prometheus output, with whatever the counters really say | [ ] |
| 06 | publish/subscribe round-trip | A message reaches a subscriber | [ ] |
| 07 | reconnect after server restart | Backoff timings, as they actually occur | [ ] |
| 08 | flood → `4002` close | The rate limiter genuinely fires | [ ] |
| 09 | bad token → `4001` close | Auth genuinely rejects | [ ] |
| 10 | browser client session | A real page, in a real browser | [ ] |

Items 06-09 will not be screenshots of someone typing into `wscat`. Each becomes
a small real client under `scripts/` that drives the behaviour and prints a
transcript — stronger evidence, and runnable as an integration check.

## How these get produced

By the evidence tool in `guide/evidence/` — designed but not yet built. It takes
a **command**, never content: it runs the command, captures real stdout, and
renders it with a provenance footer (command, exit code, UTC timestamp, git SHA,
platform) plus a sidecar JSON holding the raw output.

There is no field in its config for supplying content. That absence is the point.
Fabricating again would require editing the tool itself.

Until it lands, this directory holds two text files and no images. That is the
honest state, and it is preferable to the alternative.
