import type { SessionDiagnostics, SessionSummary } from "@/types/diagnostics";

export function createSessionDiagnostics(sessionId: string, startedAt: string): SessionDiagnostics {
  return {
    sessionId,
    startedAt,
    updatedAt: startedAt,
    counters: {
      marketsScanned: 0,
      opportunitiesFound: 0,
      rejectedByLiquidity: 0,
      rejectedByStaleData: 0,
      rejectedByLowEdge: 0,
      paperTradesOpened: 0,
    },
    cumulativeEdgePct: 0,
    averageEdgePct: 0,
  };
}

export function incrementMarketsScanned(diagnostics: SessionDiagnostics, updatedAt: string): SessionDiagnostics {
  return {
    ...diagnostics,
    updatedAt,
    counters: {
      ...diagnostics.counters,
      marketsScanned: diagnostics.counters.marketsScanned + 1,
    },
  };
}

export function recordOpportunity(
  diagnostics: SessionDiagnostics,
  edgePct: number,
  updatedAt: string,
): SessionDiagnostics {
  const opportunitiesFound = diagnostics.counters.opportunitiesFound + 1;
  const cumulativeEdgePct = diagnostics.cumulativeEdgePct + edgePct;
  const averageEdgePct = opportunitiesFound > 0 ? cumulativeEdgePct / opportunitiesFound : 0;

  return {
    ...diagnostics,
    updatedAt,
    counters: {
      ...diagnostics.counters,
      opportunitiesFound,
    },
    cumulativeEdgePct,
    averageEdgePct,
  };
}

export function incrementRejectedByLiquidity(
  diagnostics: SessionDiagnostics,
  updatedAt: string,
): SessionDiagnostics {
  return {
    ...diagnostics,
    updatedAt,
    counters: {
      ...diagnostics.counters,
      rejectedByLiquidity: diagnostics.counters.rejectedByLiquidity + 1,
    },
  };
}

export function incrementRejectedByStaleData(
  diagnostics: SessionDiagnostics,
  updatedAt: string,
): SessionDiagnostics {
  return {
    ...diagnostics,
    updatedAt,
    counters: {
      ...diagnostics.counters,
      rejectedByStaleData: diagnostics.counters.rejectedByStaleData + 1,
    },
  };
}

export function incrementRejectedByLowEdge(
  diagnostics: SessionDiagnostics,
  updatedAt: string,
): SessionDiagnostics {
  return {
    ...diagnostics,
    updatedAt,
    counters: {
      ...diagnostics.counters,
      rejectedByLowEdge: diagnostics.counters.rejectedByLowEdge + 1,
    },
  };
}

export function incrementPaperTradesOpened(
  diagnostics: SessionDiagnostics,
  updatedAt: string,
): SessionDiagnostics {
  return {
    ...diagnostics,
    updatedAt,
    counters: {
      ...diagnostics.counters,
      paperTradesOpened: diagnostics.counters.paperTradesOpened + 1,
    },
  };
}

export function buildSessionSummary(diagnostics: SessionDiagnostics, finishedAt: string): SessionSummary {
  return {
    sessionId: diagnostics.sessionId,
    startedAt: diagnostics.startedAt,
    finishedAt,
    totalMarketsScanned: diagnostics.counters.marketsScanned,
    totalOpportunitiesFound: diagnostics.counters.opportunitiesFound,
    rejectedByLiquidity: diagnostics.counters.rejectedByLiquidity,
    rejectedByStaleData: diagnostics.counters.rejectedByStaleData,
    rejectedByLowEdge: diagnostics.counters.rejectedByLowEdge,
    averageEdgePct: diagnostics.averageEdgePct,
    paperTradesOpened: diagnostics.counters.paperTradesOpened,
  };
}
