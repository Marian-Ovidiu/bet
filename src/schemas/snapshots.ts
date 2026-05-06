import { z } from "zod";

export const isoTimestampSchema = z.iso.datetime({ offset: true });

export const exchangeSnapshotSchema = z.object({
  exchange: z.string().min(1),
  eventId: z.string().min(1),
  eventName: z.string().min(1),
  marketType: z.string().min(1),
  selection: z.string().min(1),
  backOdds: z.number().positive(),
  layOdds: z.number().positive(),
  liquidity: z.number().nonnegative(),
  timestamp: isoTimestampSchema,
});

export const marketSnapshotSchema = z.object({
  eventId: z.string().min(1),
  eventName: z.string().min(1),
  marketType: z.string().min(1),
  selection: z.string().min(1),
  snapshots: z.array(exchangeSnapshotSchema).min(1),
  timestamp: isoTimestampSchema,
});
