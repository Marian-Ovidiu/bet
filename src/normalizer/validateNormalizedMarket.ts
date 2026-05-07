import type { IsoTimestamp } from "@/types/common";

export type NormalizedMarketRejectionReason =
  | "missing_event_id"
  | "missing_selection"
  | "invalid_odds"
  | "duplicate_outcome"
  | "incomplete_market"
  | "stale_market";

export interface NormalizedMarketOutcome {
  bookmaker: string;
  outcome: string;
  odds: number | null;
  sourceTimestamp?: IsoTimestamp | null;
}

export interface NormalizedMarketForValidation {
  eventId: string;
  eventName: string;
  marketType: string;
  outcomes: NormalizedMarketOutcome[];
}

export interface ValidateNormalizedMarketInput {
  market: NormalizedMarketForValidation;
  nowIso: IsoTimestamp;
  staleDataThresholdMs: number;
}

export interface ValidateNormalizedMarketResult {
  valid: boolean;
  rejectionReasons: NormalizedMarketRejectionReason[];
}

export function validateNormalizedMarket(input: ValidateNormalizedMarketInput): ValidateNormalizedMarketResult {
  const reasons = new Set<NormalizedMarketRejectionReason>();
  const { market } = input;

  if (market.eventId.trim().length === 0) {
    reasons.add("missing_event_id");
  }
  if (market.eventName.trim().length === 0 || market.marketType.trim().length === 0) {
    reasons.add("incomplete_market");
  }
  if (market.outcomes.length === 0) {
    reasons.add("incomplete_market");
  }

  const uniqueOutcomes = new Set<string>();
  const bookmakerOutcomePairs = new Set<string>();
  const nowMs = Date.parse(input.nowIso);

  for (const outcome of market.outcomes) {
    const normalizedOutcome = outcome.outcome.trim();
    const normalizedBookmaker = outcome.bookmaker.trim();
    if (normalizedOutcome.length === 0) {
      reasons.add("missing_selection");
    } else {
      uniqueOutcomes.add(normalizedOutcome);
    }

    if (!isValidDecimalOdds(outcome.odds)) {
      reasons.add("invalid_odds");
    }

    const pairKey = `${normalizedBookmaker}|${normalizedOutcome}`;
    if (bookmakerOutcomePairs.has(pairKey)) {
      reasons.add("duplicate_outcome");
    } else {
      bookmakerOutcomePairs.add(pairKey);
    }

    if (outcome.sourceTimestamp) {
      const sourceMs = Date.parse(outcome.sourceTimestamp);
      if (Number.isFinite(sourceMs) && nowMs - sourceMs > input.staleDataThresholdMs) {
        reasons.add("stale_market");
      }
    }
  }

  if (isFootballHeadToHead(market.marketType) && uniqueOutcomes.size !== 2 && uniqueOutcomes.size !== 3) {
    reasons.add("incomplete_market");
  }

  return {
    valid: reasons.size === 0,
    rejectionReasons: Array.from(reasons),
  };
}

function isValidDecimalOdds(odds: number | null): odds is number {
  return typeof odds === "number" && Number.isFinite(odds) && odds > 1.01;
}

function isFootballHeadToHead(marketType: string): boolean {
  return marketType === "football_match_odds" || marketType === "h2h";
}
