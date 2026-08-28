# Bankai Constitution

Bankai owns the agent loop. The model is a swappable engine. These rules are always loaded.

## Hard Constraints
- Never hardcode `if provider == ...` in agent code. Use the gateway + adapter layer.
- Deny rules are in code, not prompts.
- The agent cannot declare "done" by re-reading its own diff. Verification is external.
- Never stash the whole repo or wiki into context. Use pointer-based navigation (glob, grep, head, tail).
- Never ask before every bash command. Headless default is `dontAsk`; only classified host/network calls pause.
- The sandbox never holds real credentials. Broker them externally.

## Routing
- `model="coding-primary"` is the alias the loop uses. The gateway resolves it.
- Thinking blocks must pass back unmodified with their tool results. Strip on model switch.
- Fallback is availability, not quality. A fallback is a different eval cell.

## Structure
- `packages/` — harness libraries.
- `apps/cli` — the `bankai` binary.
- `skills/` — progressive disclosure skill files.
- `AGENTS.md` — this file, short constitution.
- `PLAN.md` — checkpoint plan with validation commands.

## CLI Flags
- `--eval` / `-e` — run the built-in eval suite (JSONL trace to stdout).
- `--sandbox` / `-s` — run code_exec in a Docker container (workspace-write, no network).
- `--model <alias>` — select model alias (coding-primary, cheap-compact, gpt-4o).
- `--max-iterations <n>` — cap ReAct loop iterations (default: 50).
- `--max-tokens <n>` — total token budget (default: 100000).
- `--max-budget <usd>` — USD cost cap (default: 10).
- `--verbose` / `-v` — verbose telemetry output.
- `--dont-ask` — auto-approve all tool calls (headless mode).
- `--help` / `-h` — show full usage.

## Environment
- `BANKAI_DATABASE_URL` — Postgres connection for persistent budget tracking (Phase 10).
- `BANKAI_SESSION_ID` — session ID for budget tracking (default: `bankai_<timestamp>`).
- `BANKAI_MODEL` — override default model alias.
- `BANKAI_ANTHROPIC_API_KEY` / `BANKAI_OPENAI_API_KEY` — API keys.

## Phase 10 Features
- **Postgres budget tracker**: When `BANKAI_DATABASE_URL` is set, spend is persisted to Postgres across sessions. Falls back to in-memory when unset.
- **Progressive compaction**: Tool results are capped at 2000 chars. After 1/3 of max iterations, earlier conversation turns are summarized and pruned (system prompt + AGENTS.md always preserved). The agent can also call `compact` to trigger compaction on demand.
- **Per-model tool profiles**: Cheap models get a reduced tool set (e.g., cheap-compact: bash, file_read, file_edit only).
- **Per-model prompt profiles**: Each model alias can override the system prompt for its speciality (e.g., cheap-compact for critique).

## Available Skills
- `project-analysis` — understand codebases (module discovery, data flow)
- `test-writer` — write tests that fail before the fix (edge cases, not just happy path)
- `refactor` — improve code structure without changing behavior
