export type PaperTradeStatus = "opened" | "partial_fill" | "rejected" | "unmatched_risk";

export interface PaperTrade {
  id: string;
  opportunityId: string;
  eventName: string;
  marketType: string;
  selection: string;
  backExchange: string;
  layExchange: string;
  stake: number;
  expectedProfit: number;
  simulatedProfit: number;
  status: PaperTradeStatus;
  openedAt: string;
  rejectionReason?: string;
}

export interface PaperExecutionStats {
  paperTradesOpened: number;
  paperTradesRejected: number;
  partialFills: number;
  unmatchedRiskEvents: number;
  startingBalance: number;
  endingBalance: number;
  realizedPaperPnl: number;
  maxOpenExposure: number;
  currentOpenExposure: number;
}
