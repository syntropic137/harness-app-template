---
name: Directory Test Fixture
description: Test case for directory-as-file validation
status: accepted
---

# ADR-0002: Directory Test Fixture

**Date:** 2026-05-30
**Category:** Testing

## Context

Test that validator correctly identifies when a directory is created with an ADR filename.

## Decision

Create this file as part of test fixtures.

## Consequences

Used in validator tests to verify proper file vs directory distinction.
