---
name: project-analysis
description: "Understand an unfamiliar codebase — modules, data flow, conventions"
tier: 1
tools_required: [file_read, bash]
tags: [exploration, architecture]
---

# Project Analysis Skill

## Overview
When asked to understand a codebase, follow this sequence:
1. Read the README, package.json, and any AGENTS.md
2. Identify the entry point and module structure
3. Trace the data flow for the specific feature in question
4. Summarize the architecture in your own words

## Tier 1 (Quick Scan)
- Run `ls` at the project root
- `cat README.md` or `cat package.json`
- Identify the framework (React, Svelte, Node, etc.)

## Tier 2 (Deep Dive)
- Find all source files: `find src -name "*.ts" -o -name "*.js"`
- Read the main entry point
- Look for config files (tsconfig, vite, etc.)

## Tier 3 (Architecture)
- For each module, identify purpose and key exports
- Trace a sample request through the system
- Note any non-obvious patterns or conventions
