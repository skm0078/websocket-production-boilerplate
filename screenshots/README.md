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
