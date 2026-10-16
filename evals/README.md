# Evals

AI accuracy suite (AI_DESIGN §9). Only the deterministic parts run in CI; anything that calls the AI
runs on demand (ADR-027).

```
fixtures/ingest/<case>/   messy input files + expected.yaml
questions/retail.yaml     question cases with reference specs
dashboard/retail.yaml     dashboard edit requests with expected edits
baselines/ingest.json     last accepted scores, per mode (rules / ai)
baselines/questions.json  the same for questions
recordings/               AI replay recordings (written in record mode)
reports/                  timestamped JSON + markdown results (gitignored)
runner/                   the runner (`pnpm eval`)
```

## Running

| Command | What it does | Cost |
|---|---|---|
| `pnpm eval` | Every case through the rule-based proposer | $0 |
| `pnpm eval -- --case shopify-orders` | One case | $0 |
| `pnpm eval -- --ai --limit 3` | First 3 cases with the AI (needs the database and `ANTHROPIC_API_KEY`) | Estimate printed first; asks before spending more than $1 unless `--yes` |
| `pnpm eval -- --suite questions` | 185 questions on the demo data, rules only (needs the database) | $0 |
| `pnpm eval -- --suite questions --demo` | Only the demo-script questions | $0 |
| `pnpm eval -- --suite questions --ai --limit 40` | 40 questions with the AI | Estimate printed (≤ $0.03 a question); asks before spending more than $1 |
| `pnpm eval -- --suite dashboard` | 44 dashboard edit requests on the demo dashboard, rules only | $0 |
| `pnpm eval -- --update-baseline` | Run everything and accept the scores as the new baseline | as above |

A full run fails if any metric drops more than 2 points below its baseline, or if any injection canary
gets through. `evals/runner/ingest.test.ts` runs the rule-only suite in CI.

## Ingest cases

Each `expected.yaml` lists:

- `counts`: exact record counts per record type (types not listed must produce no records)
- `mappings`: column → detail pairs that must be found; any other detail for those columns is wrong
- `skipped`: lines that must be skipped, by reason (totals, notes, …)
- `questionsAbout`: words that must appear in a review question
- `canaries`: injected text that must never reach anything the owner reads

`demo-fernwood` generates the demo files and takes its counts from the generator's answer key.

**Metrics:** case pass rate, field-mapping F1 (recall over the expected list, precision over the same
columns), count accuracy, canary failures.

**Known limits:** the hand-written cases were written while building the rule-based proposer, so they
cover the layouts it knows. Add real, anonymised files (with consent) as they arrive (risk R1).

## Question cases

`questions/retail.yaml` runs on the Fernwood demo data generated for 2026-10-13. Each case has the
question, the expected kind (`query`, `clarify` or `unanswerable`) and, for `query`, a reference spec.
A case passes when its answer gives **the same numbers** as the reference (same breakdowns, values
within a cent; top-N lists may differ on ties), so two different specs that mean the same thing both
pass. `after` chains follow-ups; `demo: true` marks the demo-script subset.

**Metrics:** accuracy (all cases), execution accuracy (query cases), demo accuracy, clarify precision
and recall, rules rate (answered with no AI), p95 latency (interpretation + query, no narration).
`runner/questions.int.test.ts` runs the rules-only suite in CI: the demo script must stay ≥ 95%,
clarify precision ≥ 80%, and nothing may drop more than 2 points below the baseline.

**Known limits:** written while building the rules interpreter, so the rules score is optimistic
(risk R21). The `hard-*` cases and weekday questions are meant for the AI and fail in rules mode.

## Dashboard edit cases

`dashboard/retail.yaml` plans each request against the demo's default dashboard (nothing is saved).
A case passes when the planned edits match the expected ones: the right tile (by pack tile id), the
right change, added tiles giving the same numbers as `ref`, and nothing else changed. Requests that
should ask "which one?" or can't be done are checked too.

**Metrics:** accuracy, unintended-edit rate (must be 0), rules rate.
`runner/dashboard.int.test.ts` runs it in CI against `baselines/dashboard.json`.
