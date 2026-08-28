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

## Available Skills
- `project-analysis` — understand codebases (module discovery, data flow)
- `test-writer` — write tests that fail before the fix (edge cases, not just happy path)
- `refactor` — improve code structure without changing behavior
