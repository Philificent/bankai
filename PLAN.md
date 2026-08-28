# Bankai — Build Plan

## Milestone 1: Core Loop + Canonical Tools (Week 1)
- [x] Project scaffold (pnpm workspace, tsconfig.base, root package.json)
- [x] packages/core: ReAct loop driver with hard caps
- [x] packages/tools: bash, file_read, file_edit, code_exec sandbox
- [x] apps/cli: bankai binary entry point
- [x] Tests: core loop + canonical tools (15 + 4 + 6 = 25 tests, all passing)
- [x] Commit + push ✓ (c6ec8fa)

## Milestone 2: Gateway + Adapter + Permissions (Week 2)
- [x] packages/gateway: capability adapter (OpenAI + Anthropic), thinking block preservation
- [x] packages/gateway: GatewayRouter with alias resolution, retry, budget tracking
- [x] packages/permissions: deny/ask/allow stack with bash deny patterns
- [x] Durable files: AGENTS.md constitution, PLAN.md
- [x] Tests: gateway adapters (8), permissions (13), CLI updated (5) — 45 tests total, all passing
- [x] Commit + push ✓ (98e9ea9)

## Milestone 3: Verification + Evals + Graph
- [x] packages/verify: pre-completion check pipeline (typecheck, test, lint)
- [x] packages/evals: JSONL traces, outcome graders, default eval cases
- [x] packages/graph: typed state graph with checkpointing, subagents, max iterations
- [x] Tests: verify (3) + evals (5) + graph (3) = 11 new tests
- [x] Commit + push ✓ (5511ad6)

## Phase 4: Durable Files
- [x] features.json: machine-readable feature tracking
- [x] AGENTS.md: enhanced with model aliases, permission stack, tool list
- [x] PLAN.md: checkpoint plan with validation commands
- [x] Commit + push ✓ (cde6bde)

## Phase 8: Skills Directory
- [x] skills/ directory with progressive disclosure skill files
- [x] packages/core: SkillLoader for skills/ discovery
- [x] apps/cli: loads skills from working directory
- [x] Commit + push (cde6bde)

## Milestone 3: Phase 10 Advanced Features

### Postgres Budget Tracker
- [x] packages/gateway: AsyncBudgetTracker interface
- [x] packages/gateway: PostgresBudgetTracker with pg, session_id tracking, table schema
- [x] packages/gateway: GatewayRouter supports async budget tracker
- [x] apps/cli: auto-detect BANKAI_DATABASE_URL, use PostgresBudgetTracker, close on shutdown

### Progressive Compaction (Phase 10)
- [x] packages/core: Tool-result capping (maxToolOutputTokens config option)
- [x] packages/core: Context compaction at task boundaries (compactionThreshold, compactionPreserveTurns)
- [x] packages/core: Compaction trace entries for observability
- [x] apps/cli: compaction config wired into AgentConfig

### Eval CLI Integration (Phase 7)
- [x] apps/cli: --eval/-e flag for running eval suite
- [x] apps/cli: EvalRunner integration with fresh session per case
- [x] apps/cli: JSONL trace output to stdout, telemetry to stderr
- [x] apps/cli: auto-detect BANKAI_DATABASE_URL for persistent budgets

### Sandbox + Per-Model Profiles (Phase 10)
- [x] packages/tools: createSandboxedCodeExecTool (Docker container, workspace-write, no network)
- [x] apps/cli: --sandbox/-s flag for OS-level isolation
- [x] packages/gateway: per-model tool profiles (tool allowlist per alias)
- [x] packages/gateway: per-model prompt profiles (system prompt override per alias)
- [x] apps/cli: toolProfiles and promptProfiles wired into GatewayConfig

### Tests
- [x] Core: tool output capping (1 test)
- [x] Core: progressive compaction (1 test)
- [x] Tools: createSandboxedCodeExecTool metadata (1 test)
- [x] CLI: --eval/-e flag parsing (3 tests), --sandbox/-s flag parsing (3 tests), total 10
- [x] Total: 68 tests across 8 packages, 0 failures

- [x] Commit + push ✓ (40d76b2)
