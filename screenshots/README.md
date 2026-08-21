# Screenshots — visual evidence

> **Captured evidence > claims. If a screenshot doesn't exist, the blog doesn't
> claim it.**

The first images in this directory were mock-ups rendered from HTML, not
captures of real runs. They have been replaced by the captures below.
Nothing was ever published from them.

## What is real, and stays

| File | Status |
|---|---|
| `screenshot-02-tests-passing.txt` | **Real** `npm test` output |
| `screenshot-03-typecheck-passing.txt` | **Real** `npm run typecheck` output |


## Captured

Real artifacts now live in `evidence/`, produced by `evidence capture` from the
`engine` repo. Each PNG has a `.json` manifest beside it holding the command,
exit code, timestamp, git SHA, platform and the complete raw output.

| Evidence | Command | CI |
|---|---|---|
| `evidence/tests-passing.png` | `npm test` | staleness-checked |
| `evidence/typecheck-passing.png` | `npm run typecheck` | staleness-checked |
| `evidence/docker-compose-up.png` | `docker compose up -d --build && docker compose ps` | local only |

**To check any of them:** open the manifest, read the `command`, run it yourself.

CI re-checks freshness on every push via `.github/workflows/evidence.yml`. If a
`dependsOn` path changes and the evidence is not re-captured, the build fails.
Captures needing Docker are skipped there and stay marked `captured-locally` in
both the manifest and the footer.

## All behaviours captured

| Evidence | What it proves |
|---|---|
| `evidence/tests-passing.png` | the suite passes, with the real count and timing |
| `evidence/typecheck-passing.png` | strict TypeScript compiles clean |
| `evidence/docker-compose-up.png` | app and Redis actually start; `ps` shows Redis loopback-bound |
| `evidence/pubsub-round-trip.png` | a publish reaches a **separate** subscriber, so fan-out works |
| `evidence/auth-reject-4001.png` | an invalid token is closed with 4001 |
| `evidence/rate-limit-4002.png` | flooding past 30 msg/s is closed with 4002 |
| `evidence/client-reconnect-backoff.png` | the shipped client reconnects through a real container restart |

The last four run real clients under `scripts/demo/`, not screenshots of someone
typing. Each exits non-zero if the behaviour does not occur, so they double as
integration checks.

**The backoff one is worth looking at twice.** The delays it prints vary run to
run - `905ms, 2212ms, 4214ms` on one, `891ms, 1810ms, 3751ms, 8425ms` on
another - because the client applies +-15% jitter. The mock-up this
replaced claimed a tidy "1s, 2s, 4s", which jitter can never produce. That
variance is the signature of a real measurement.

**To check any of them:** open the manifest beside it, read the `command`, run
it yourself.
