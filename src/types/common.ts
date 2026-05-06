export type IsoTimestamp = string;

export type ExchangeName = string;
export type EventId = string;
export type MarketType = string;
export type SelectionName = string;

export interface TimestampedRecord {
  timestamp: IsoTimestamp;
}
