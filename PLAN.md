# Bankai — Build Plan

## Milestone 1: Core Loop + Canonical Tools (Week 1)
- [x] Project scaffold (pnpm workspace, tsconfig.base, root package.json)
- [x] packages/core: ReAct loop driver with hard caps
- [x] packages/tools: bash, file_read, file_edit, code_exec sandbox
- [x] apps/cli: bankai binary entry point
- [x] Tests: core loop + canonical tools (15 + 4 + 6 = 25 tests, all passing)
- [ ] End-to-end smoke test against real API
- [ ] Commit + push

## Milestone 2: Gateway + Adapter (Week 2)
- [ ] packages/gateway: LiteLLM adapter, per-provider tool projection
- [ ] packages/budget: Postgres-backed spend tracking
- [ ] Durable files: AGENTS.md constitution, PLAN.md, JSON feature list
- [ ] packages/permissions: deny/ask/allow stack, dummy secrets

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
