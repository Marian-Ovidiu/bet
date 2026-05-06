---
name: arb-engine
description: Implement deterministic arbitrage detection across exchanges with commission and liquidity-aware calculations, diagnostics, and explainable opportunity outputs.
---

# arb-engine

You are implementing the arbitrage detection engine for a sports betting multi-exchange scanner.

## Responsibilities
- Compare odds across exchanges.
- Compute back/lay arbitrage.
- Account for commissions.
- Account for liquidity constraints.
- Reject low-quality opportunities.

## Requirements
- Deterministic calculations.
- No hidden assumptions.
- Full diagnostics counters.
- JSON serializable outputs.

## Every opportunity must include
- Exchanges involved
- Odds
- Liquidity
- Gross edge
- Net edge
- Estimated profit
- Rejection reasons
- Timestamps

## Reject opportunities if
- Insufficient liquidity
- Stale feeds
- Edge below threshold
- Incomplete markets

## Prioritize
- Transparency
- Explainability
- Auditability

## Implementation checklist
- Keep opportunity evaluation pure and deterministic.
- Return accepted and rejected opportunities with reasons.
- Track diagnostics (pairs compared, rejected by reason, accepted count, latency).
- Ensure outputs are stable and JSON serializable.
