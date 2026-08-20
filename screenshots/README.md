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

## Still to capture

Four behaviours are not yet evidenced, because the honest version of each is a
real client script rather than a screenshot of someone typing into `wscat`:

| # | Behaviour | Status |
|---|---|---|
| 06 | publish/subscribe round-trip | [ ] |
| 07 | reconnect after server restart, real backoff timings | [ ] |
| 08 | flood -> `4002` close | [ ] |
| 09 | bad token -> `4001` close | [ ] |

Each becomes a small script under `scripts/` that drives the behaviour and
prints a transcript, captured as an ordinary command. That is stronger evidence
than a screenshot, and it doubles as a runnable integration check.

Until those exist, the blog does not claim them.
