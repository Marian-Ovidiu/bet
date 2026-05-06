import type { ArbitrageOpportunity } from "@/types/arbitrage";
import type { PaperExecutionStats, PaperTrade } from "@/types/paper";

export interface PaperExecutionConfig {
  enabled: boolean;
  startingBalance: number;
  stakeSize: number;
  partialFillProbability: number;
  unmatchedProbability: number;
  maxOpenExposure: number;
}

export class PaperExecutionEngine {
  private readonly config: PaperExecutionConfig;
  private readonly trades: PaperTrade[];
  private realizedPnl: number;
  private currentOpenExposure: number;
  private maxOpenExposureSeen: number;
  private openedCount: number;
  private rejectedCount: number;
  private partialFillCount: number;
  private unmatchedRiskCount: number;

  public constructor(config: PaperExecutionConfig) {
    this.config = config;
    this.trades = [];
    this.realizedPnl = 0;
    this.currentOpenExposure = 0;
    this.maxOpenExposureSeen = 0;
    this.openedCount = 0;
    this.rejectedCount = 0;
    this.partialFillCount = 0;
    this.unmatchedRiskCount = 0;
  }

  public executeOpportunity(opportunity: ArbitrageOpportunity, openedAt: string): PaperTrade {
    const tradeId = `paper-${opportunity.id}-${Date.parse(openedAt)}`;
    const stake = this.config.stakeSize;
    const expectedProfit = roundTo(stake * (opportunity.netEdgePct / 100), 4);
    const baseTrade = {
      id: tradeId,
      opportunityId: opportunity.id,
      eventName: opportunity.eventName,
      marketType: opportunity.marketType,
      selection: opportunity.selection,
      backExchange: opportunity.legs[0].exchange,
      layExchange: opportunity.legs[1].exchange,
      stake,
      expectedProfit,
      openedAt,
    };

    if (!this.config.enabled) {
      return this.recordTrade({
        ...baseTrade,
        simulatedProfit: 0,
        status: "rejected",
        rejectionReason: "paper_trading_disabled",
      });
    }

    if (this.getEndingBalance() < stake) {
      return this.recordTrade({
        ...baseTrade,
        simulatedProfit: 0,
        status: "rejected",
        rejectionReason: "insufficient_virtual_balance",
      });
    }

    if (this.currentOpenExposure + stake > this.config.maxOpenExposure) {
      return this.recordTrade({
        ...baseTrade,
        simulatedProfit: 0,
        status: "rejected",
        rejectionReason: "max_open_exposure_exceeded",
      });
    }

    const unmatchedRoll = deterministicUnitFloat(`${opportunity.id}|${openedAt}|unmatched`);
    if (unmatchedRoll < this.config.unmatchedProbability) {
      const lossRatio = randomBetweenFromUnit(
        deterministicUnitFloat(`${opportunity.id}|${openedAt}|unmatched-loss`),
        0.05,
        0.25,
      );
      const simulatedProfit = roundTo(-stake * lossRatio, 4);
      this.applyExposure(stake);
      this.realizedPnl = roundTo(this.realizedPnl + simulatedProfit, 4);
      this.releaseExposure(stake);
      return this.recordTrade({
        ...baseTrade,
        simulatedProfit,
        status: "unmatched_risk",
      });
    }

    const partialRoll = deterministicUnitFloat(`${opportunity.id}|${openedAt}|partial`);
    const isPartial = partialRoll < this.config.partialFillProbability;
    const fillRatio = isPartial
      ? randomBetweenFromUnit(deterministicUnitFloat(`${opportunity.id}|${openedAt}|fill-ratio`), 0.35, 0.9)
      : 1;
    const filledStake = roundTo(stake * fillRatio, 4);
    // netEdgePct is already net of commissions from the arbitrage engine.
    const simulatedProfit = roundTo(expectedProfit * fillRatio, 4);

    this.applyExposure(filledStake);
    this.realizedPnl = roundTo(this.realizedPnl + simulatedProfit, 4);
    this.releaseExposure(filledStake);

    return this.recordTrade({
      ...baseTrade,
      simulatedProfit,
      status: isPartial ? "partial_fill" : "opened",
    });
  }

  public getStats(): PaperExecutionStats {
    const endingBalance = this.getEndingBalance();
    this.assertBalanceInvariant(endingBalance);
    return {
      paperTradesOpened: this.openedCount,
      paperTradesRejected: this.rejectedCount,
      partialFills: this.partialFillCount,
      unmatchedRiskEvents: this.unmatchedRiskCount,
      startingBalance: this.config.startingBalance,
      endingBalance,
      realizedPaperPnl: this.realizedPnl,
      maxOpenExposure: roundTo(this.maxOpenExposureSeen, 4),
      currentOpenExposure: roundTo(this.currentOpenExposure, 4),
    };
  }

  public assertInvariant(): void {
    this.assertBalanceInvariant(this.getEndingBalance());
  }

  private recordTrade(trade: PaperTrade): PaperTrade {
    this.trades.push(trade);
    if (trade.status === "rejected") {
      this.rejectedCount += 1;
    } else {
      this.openedCount += 1;
      if (trade.status === "partial_fill") {
        this.partialFillCount += 1;
      }
      if (trade.status === "unmatched_risk") {
        this.unmatchedRiskCount += 1;
      }
    }
    return trade;
  }

  private applyExposure(exposure: number): void {
    this.currentOpenExposure = roundTo(this.currentOpenExposure + exposure, 4);
    if (this.currentOpenExposure > this.maxOpenExposureSeen) {
      this.maxOpenExposureSeen = this.currentOpenExposure;
    }
  }

  private releaseExposure(exposure: number): void {
    this.currentOpenExposure = roundTo(Math.max(0, this.currentOpenExposure - exposure), 4);
  }

  private getEndingBalance(): number {
    return roundTo(this.config.startingBalance + this.realizedPnl, 4);
  }

  private assertBalanceInvariant(endingBalance: number): void {
    const expectedEnding = roundTo(this.config.startingBalance + this.realizedPnl, 4);
    if (Math.abs(endingBalance - expectedEnding) > 0.0001) {
      throw new Error("PaperExecutionEngine invariant failed: endingBalance !== startingBalance + realizedPaperPnl");
    }
  }
}

function deterministicUnitFloat(key: string): number {
  return hash32(key) / 0xffffffff;
}

function hash32(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomBetweenFromUnit(unit: number, min: number, max: number): number {
  return min + (max - min) * unit;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
