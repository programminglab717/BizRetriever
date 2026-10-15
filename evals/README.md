# Evals

AI accuracy suite (AI_DESIGN §9). Only the deterministic parts run in CI; anything that calls the AI
runs on demand (ADR-027).

```
fixtures/ingest/<case>/   messy input files + expected.yaml
baselines/ingest.json     last accepted scores, per mode (rules / ai)
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
