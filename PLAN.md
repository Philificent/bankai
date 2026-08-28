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
- [x] packages/evals: JSONL traces, outcome graders
- [x] packages/graph: typed state graph with checkpointing, subagents, max iterations
- [x] Tests: verify (3) + evals (5) + graph (3) = 11 new tests
- [ ] Commit + push
