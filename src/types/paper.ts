export type PaperTradeStatus = "opened" | "partial_fill" | "rejected" | "unmatched_risk";
export type PaperCommissionModel = "profit_based";

export interface PaperTrade {
  tradeId: string;
  opportunityId: string;
  detectedAt: string;
  openedAt: string;
  eventName: string;
  marketType: string;
  selection: string;
  backExchange: string;
  layExchange: string;
  backOdds: number;
  layOdds: number;
  stake: number;
  grossEdgePct: number;
  netEdgePct: number;
  grossProfit: number;
  expectedProfit: number;
  simulatedProfit: number;
  status: PaperTradeStatus;
  fillRatio: number;
  effectiveCommissionRate: number;
  commissionModel: PaperCommissionModel;
  estimatedCommissionPaid: number;
  actualCommissionPaid: number;
  rejectionReason?: string;
}

export interface PaperExecutionStats {
  paperTradesOpened: number;
  paperTradesRejected: number;
  partialFills: number;
  unmatchedRiskEvents: number;
  startingBalance: number;
  endingBalance: number;
  totalGrossProfit: number;
  totalCommissionPaid: number;
  realizedPaperPnl: number;
  maxOpenExposure: number;
  currentOpenExposure: number;
  avgProfitPerTrade: number;
  bestTrade: PaperTrade | null;
  worstTrade: PaperTrade | null;
  partialFillRate: number;
  unmatchedRiskRate: number;
}
