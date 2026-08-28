# Bankai

The ultimate AI coding agent harness. Owns the loop. The model is a swappable engine.

## What is Bankai?

Bankai is a production-grade, multi-provider coding agent harness built on the
principles in the [harness-engineering report](https://github.com/ai-boost/awesome-harness-engineering).
It owns context delivery, tools, planning artifacts, verification, memory, sandbox,
and evals. The model only produces the next action.

## Quick start

```bash
git clone https://github.com/Philificent/bankai.git
cd bankai
pnpm install
pnpm build
```

## Usage

```bash
# Run a coding task
bankai "fix the login form validation bug"

# Run with a specific model
bankai --model gpt-4o "refactor auth.ts"

# Run the eval suite
bankai --eval
# or: pnpm test

# Get help
bankai --help
```

## CLI Flags

| Flag | Alias | Description |
|---|---|---|
| `--model <name>` | | Model alias (default: `coding-primary`) |
| `--working-dir <dir>` | | Working directory (default: cwd) |
| `--max-iterations <n>` | | Max ReAct loop iterations (default: 50) |
| `--max-tokens <n>` | | Total token budget (default: 100000) |
| `--max-budget <usd>` | | USD cost cap (default: 10) |
| `--idle-timeout <ms>` | | Idle timeout (default: 300000) |
| `--eval` | `-e` | Run the built-in eval suite |
| `--sandbox` | `-s` | Run code_exec in Docker |
| `--verbose` | `-v` | Verbose telemetry |
| `--dont-ask` | | Auto-approve all tool calls (headless) |
| `--help` | `-h` | Show full usage |

## Environment Variables

| Variable | Description |
|---|---|
| `BANKAI_DATABASE_URL` | Postgres connection for persistent budget tracking |
| `BANKAI_SESSION_ID` | Session ID for budget tracking |
| `BANKAI_ANTHROPIC_API_KEY` | Anthropic API key |
| `BANKAI_OPENAI_API_KEY` | OpenAI API key |

## Architecture

```
bankai/
├── packages/
│   ├── core/         # ReAct agent loop, session management, progressive compaction
│   ├── tools/        # Canonical tools: bash, file_read, file_edit, code_exec
│   ├── gateway/      # LiteLLM-style router, per-provider adapters, budget tracking
│   ├── permissions/  # Deny/ask/allow stack with escalation
│   ├── verify/       # Pre-completion verification pipeline
│   ├── evals/        # JSONL traces, outcome graders, 20-50 task suites
│   ├── graph/        # Typed state graph (LangGraph-style)
│   └── skills/       # Progressive disclosure skill files
└── apps/cli/         # `bankai` binary
```

## Available Tools

- **bash** — run shell commands
- **file_read** — read files (path-traversal safe)
- **file_edit** — edit files with staleness check
- **code_exec** — sandboxed code execution (Docker, no network)
- **compact** — trigger context compaction on demand

## Skills

Bankai uses progressive disclosure for skills. `name`/`description` are always loaded
(about 100 tokens each) — the `SKILL.md` body is loaded on trigger (under 5k tokens).
Negative examples in descriptions improve routing accuracy.

## License

MIT
