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
  private totalGrossProfit: number;
  private totalCommissionPaid: number;
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
    this.totalGrossProfit = 0;
    this.totalCommissionPaid = 0;
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
    const expectedGrossProfit = roundTo(stake * (opportunity.grossEdgePct / 100), 4);
    const effectiveCommissionRate = clamp(
      opportunity.legs[0].commissionRate + opportunity.legs[1].commissionRate,
      0,
      1,
    );
    const estimatedCommissionPaid = calculateProfitBasedCommission(expectedGrossProfit, effectiveCommissionRate);
    const baseTrade = {
      tradeId,
      opportunityId: opportunity.id,
      detectedAt: opportunity.detectedAt,
      openedAt,
      eventName: opportunity.eventName,
      marketType: opportunity.marketType,
      selection: opportunity.selection,
      backExchange: opportunity.legs[0].exchange,
      layExchange: opportunity.legs[1].exchange,
      backOdds: opportunity.legs[0].odds,
      layOdds: opportunity.legs[1].odds,
      stake,
      grossEdgePct: opportunity.grossEdgePct,
      netEdgePct: opportunity.netEdgePct,
      grossProfit: 0,
      expectedProfit,
      effectiveCommissionRate,
      commissionModel: "profit_based" as const,
      estimatedCommissionPaid,
    };

    if (!this.config.enabled) {
      return this.recordTrade({
        ...baseTrade,
        simulatedProfit: 0,
        status: "rejected",
        fillRatio: 0,
        actualCommissionPaid: 0,
        rejectionReason: "paper_trading_disabled",
      });
    }

    if (this.getEndingBalance() < stake) {
      return this.recordTrade({
        ...baseTrade,
        simulatedProfit: 0,
        status: "rejected",
        fillRatio: 0,
        actualCommissionPaid: 0,
        rejectionReason: "insufficient_virtual_balance",
      });
    }

    if (this.currentOpenExposure + stake > this.config.maxOpenExposure) {
      return this.recordTrade({
        ...baseTrade,
        simulatedProfit: 0,
        status: "rejected",
        fillRatio: 0,
        actualCommissionPaid: 0,
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
      const grossProfit = roundTo(-stake * lossRatio, 4);
      const actualCommissionPaid = calculateProfitBasedCommission(grossProfit, effectiveCommissionRate);
      const simulatedProfit = grossProfit;
      this.applyExposure(stake);
      this.recordAccounting(grossProfit, actualCommissionPaid, simulatedProfit);
      this.releaseExposure(stake);
      return this.recordTrade({
        ...baseTrade,
        grossProfit,
        simulatedProfit,
        status: "unmatched_risk",
        fillRatio: 1,
        actualCommissionPaid,
        rejectionReason: "lay_leg_unmatched_after_back_fill",
      });
    }

    const partialRoll = deterministicUnitFloat(`${opportunity.id}|${openedAt}|partial`);
    const isPartial = partialRoll < this.config.partialFillProbability;
    const fillRatio = isPartial
      ? randomBetweenFromUnit(deterministicUnitFloat(`${opportunity.id}|${openedAt}|fill-ratio`), 0.35, 0.9)
      : 1;
    const filledStake = roundTo(stake * fillRatio, 4);
    const grossProfit = roundTo(filledStake * (opportunity.grossEdgePct / 100), 4);
    const actualCommissionPaid = calculateProfitBasedCommission(grossProfit, effectiveCommissionRate);
    const simulatedProfit = roundTo(expectedProfit * fillRatio, 4);

    this.applyExposure(filledStake);
    this.recordAccounting(grossProfit, actualCommissionPaid, simulatedProfit);
    this.releaseExposure(filledStake);

    return this.recordTrade({
      ...baseTrade,
      grossProfit,
      simulatedProfit,
      status: isPartial ? "partial_fill" : "opened",
      fillRatio: roundTo(fillRatio, 4),
      actualCommissionPaid,
    });
  }

  public getStats(): PaperExecutionStats {
    const endingBalance = this.getEndingBalance();
    const executedTrades = this.trades.filter((trade) => trade.status !== "rejected");
    const realizedPaperPnl = this.getRealizedPnl();
    this.assertAccountingInvariant(realizedPaperPnl);
    this.assertBalanceInvariant(endingBalance);
    return {
      paperTradesOpened: this.openedCount,
      paperTradesRejected: this.rejectedCount,
      partialFills: this.partialFillCount,
      unmatchedRiskEvents: this.unmatchedRiskCount,
      startingBalance: this.config.startingBalance,
      endingBalance,
      totalGrossProfit: roundTo(this.totalGrossProfit, 4),
      totalCommissionPaid: roundTo(this.totalCommissionPaid, 4),
      realizedPaperPnl,
      maxOpenExposure: roundTo(this.maxOpenExposureSeen, 4),
      currentOpenExposure: roundTo(this.currentOpenExposure, 4),
      avgProfitPerTrade: this.openedCount > 0 ? roundTo(realizedPaperPnl / this.openedCount, 4) : 0,
      bestTrade: selectTradeByProfit(executedTrades, "best"),
      worstTrade: selectTradeByProfit(executedTrades, "worst"),
      partialFillRate: this.openedCount > 0 ? roundTo(this.partialFillCount / this.openedCount, 4) : 0,
      unmatchedRiskRate: this.openedCount > 0 ? roundTo(this.unmatchedRiskCount / this.openedCount, 4) : 0,
    };
  }

  public assertInvariant(): void {
    this.assertAccountingInvariant(this.getRealizedPnl());
    this.assertBalanceInvariant(this.getEndingBalance());
  }

  private recordTrade(trade: PaperTrade): PaperTrade {
    if (trade.status === "opened" && Math.abs(trade.simulatedProfit - trade.expectedProfit) >= 0.0001) {
      throw new Error("PaperExecutionEngine invariant failed: opened simulatedProfit !== expectedProfit");
    }

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

  private recordAccounting(grossProfit: number, actualCommissionPaid: number, simulatedProfit: number): void {
    this.totalGrossProfit = roundTo(this.totalGrossProfit + grossProfit, 4);
    this.totalCommissionPaid = roundTo(this.totalCommissionPaid + actualCommissionPaid, 4);
    this.realizedPnl = roundTo(this.realizedPnl + simulatedProfit, 4);
  }

  private getEndingBalance(): number {
    return roundTo(this.config.startingBalance + this.getRealizedPnl(), 4);
  }

  private getRealizedPnl(): number {
    return roundTo(this.realizedPnl, 4);
  }

  private assertBalanceInvariant(endingBalance: number): void {
    const expectedEnding = roundTo(this.config.startingBalance + this.getRealizedPnl(), 4);
    if (Math.abs(endingBalance - expectedEnding) > 0.0001) {
      throw new Error("PaperExecutionEngine invariant failed: endingBalance !== startingBalance + realizedPaperPnl");
    }
  }

  private assertAccountingInvariant(realizedPaperPnl: number): void {
    const expectedPnl = roundTo(
      this.trades.reduce((sum, trade) => sum + (trade.status === "rejected" ? 0 : trade.simulatedProfit), 0),
      4,
    );
    if (Math.abs(realizedPaperPnl - expectedPnl) > 0.0001) {
      throw new Error("PaperExecutionEngine invariant failed: realizedPaperPnl !== sum(simulatedProfit)");
    }
  }
}

function selectTradeByProfit(trades: PaperTrade[], direction: "best" | "worst"): PaperTrade | null {
  const selected = trades.reduce<PaperTrade | null>((current, trade) => {
    if (!current) {
      return trade;
    }
    if (direction === "best") {
      return trade.simulatedProfit > current.simulatedProfit ? trade : current;
    }
    return trade.simulatedProfit < current.simulatedProfit ? trade : current;
  }, null);

  return selected ? { ...selected } : null;
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

function calculateProfitBasedCommission(grossProfit: number, effectiveCommissionRate: number): number {
  return roundTo(Math.max(grossProfit, 0) * effectiveCommissionRate, 4);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
