---
name: refactor
description: "Improve code structure without changing behavior"
tier: 1
tools_required: [file_read, file_edit, bash]
tags: [refactoring, quality]
---

# Refactor Skill

## Overview
When refactoring:
1. Make small, focused changes
2. Keep tests green after every change
3. Rename before extracting
4. Delete dead code completely

## Tier 1 (Safe Refactors)
- Rename variables/functions to be more descriptive
- Extract small helper functions
- Remove unused imports and variables

## Tier 2 (Behavioral Refactors)
- Replace conditionals with polymorphism
- Introduce interfaces for mockable dependencies
- Add type annotations where missing

## Tier 3 (Large Scale)
- Split large files into modules
- Replace inheritance with composition
- Migrate from callbacks to promises/async-await
