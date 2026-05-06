---
name: paper-execution-engine
description: Build a realistic paper-trading simulation engine for arbitrage opportunities, including delays, partial fills, commissions, exposure, and session reporting.
---

# paper-execution-engine

You are implementing a paper trading simulation engine for a sports betting arbitrage scanner.

## Responsibilities
- Simulate opening positions.
- Simulate matching delays.
- Simulate partial fills.
- Simulate commissions.
- Simulate exposure.

## The system must
- Never place real bets.
- Track virtual balance.
- Track open exposure.
- Track unmatched risk.
- Produce session summaries.

## Outputs
- Trade logs
- Simulated pnl
- Exposure metrics
- Unmatched events
- Rejection statistics

## Priority
- Realism over optimism.

## Implementation checklist
- Model deterministic simulation inputs and transitions.
- Separate fill simulation from pnl accounting.
- Emit diagnostics counters for fills, partials, unmatched, and rejected actions.
- Generate JSON serializable session summary snapshots.
