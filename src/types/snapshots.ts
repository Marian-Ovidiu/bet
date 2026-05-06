import type {
  EventId,
  ExchangeName,
  IsoTimestamp,
  MarketType,
  SelectionName,
} from "@/types/common";

export interface ExchangeSnapshot {
  exchange: ExchangeName;
  eventId: EventId;
  eventName: string;
  marketType: MarketType;
  selection: SelectionName;
  backOdds: number;
  layOdds: number;
  liquidity: number;
  timestamp: IsoTimestamp;
}

export interface MarketSnapshot {
  eventId: EventId;
  eventName: string;
  marketType: MarketType;
  selection: SelectionName;
  snapshots: ExchangeSnapshot[];
  timestamp: IsoTimestamp;
}
