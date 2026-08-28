# Bankai — Build Plan

## Milestone 1: Core Loop + Canonical Tools (Week 1)
- [x] Project scaffold (pnpm workspace, tsconfig.base, root package.json)
- [x] packages/core: ReAct loop driver with hard caps
- [x] packages/tools: bash, file_read, file_edit, code_exec sandbox
- [x] apps/cli: bankai binary entry point
- [x] Tests: core loop + canonical tools (15 + 4 + 6 = 25 tests, all passing)
- [x] Commit + push

## Milestone 2: Gateway + Adapter (Week 2)
- [x] packages/gateway: capability adapter (OpenAI + Anthropic), thinking block preservation
- [x] packages/gateway: GatewayRouter with alias resolution, retry, budget tracking
- [x] packages/permissions: deny/ask/allow stack with bash deny patterns
- [x] Durable files: AGENTS.md constitution, PLAN.md
- [x] Tests: gateway adapters (8), permissions (13), CLI updated (5) — 45 tests total, all passing
- [ ] Commit + push

## Milestone 3: Verification + Evals (Week 3)
- [ ] packages/verify: pre-completion hooks (typecheck, lint, test)
- [ ] packages/evals: JSONL traces, outcome graders, 20-task suite

## Milestone 4: Skills + Graph (Week 4)
- [ ] skills/ directory with progressive disclosure
- [ ] packages/graph: typed state graph, subagents, hibernate/wake

## Milestone 5: Phase 10 (Gated)
- [ ] Cited repo memory with JIT verification
- [ ] Progressive compaction pipeline
- [ ] Per-model prompt/tool profiles
