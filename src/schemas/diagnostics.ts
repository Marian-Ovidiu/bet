import { z } from "zod";
import { isoTimestampSchema } from "@/schemas/snapshots";

export const sessionDiagnosticsCountersSchema = z.object({
  marketsScanned: z.number().int().nonnegative(),
  opportunitiesFound: z.number().int().nonnegative(),
  rejectedByLiquidity: z.number().int().nonnegative(),
  rejectedByStaleData: z.number().int().nonnegative(),
  rejectedByLowEdge: z.number().int().nonnegative(),
  paperTradesOpened: z.number().int().nonnegative(),
});

export const sessionDiagnosticsSchema = z.object({
  sessionId: z.string().min(1),
  startedAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  counters: sessionDiagnosticsCountersSchema,
  cumulativeEdgePct: z.number(),
  averageEdgePct: z.number(),
});

export const sessionSummarySchema = z.object({
  sessionId: z.string().min(1),
  startedAt: isoTimestampSchema,
  finishedAt: isoTimestampSchema,
  totalMarketsScanned: z.number().int().nonnegative(),
  totalOpportunitiesFound: z.number().int().nonnegative(),
  rejectedByLiquidity: z.number().int().nonnegative(),
  rejectedByStaleData: z.number().int().nonnegative(),
  rejectedByLowEdge: z.number().int().nonnegative(),
  averageEdgePct: z.number(),
  paperTradesOpened: z.number().int().nonnegative(),
});
