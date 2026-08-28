---
name: test-writer
description: "Write tests that fail fast, cover edge cases, and match project conventions"
tier: 1
tools_required: [file_read, file_edit, code_exec, bash]
tags: [testing, quality]
---

# Test Writer Skill

## Overview
When asked to write tests:
1. Read existing tests to learn the project's conventions
2. Write one test per behavior
3. Use edge cases, not just the happy path
4. Make sure tests actually fail without the fix

## Tier 1 (Setup)
- Read existing test files to learn the testing framework
- Check the test configuration (vitest, node:test, jest)
- Match import style and assertion style

## Tier 2 (Implementation)
- Write the test BEFORE the fix
- Verify it fails
- Implement the fix
- Verify it passes

## Tier 3 (Edge Cases)
- Empty inputs
- Null/undefined values
- Network failures (mock)
- Concurrent access
