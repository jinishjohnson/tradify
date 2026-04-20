export type OrderSide = 'BUY' | 'SELL';
export type OrderStatus = 'PENDING' | 'FILLED' | 'CANCELLED';

export interface Trade {
  id: string;
  symbol: string;
  side: OrderSide;
  price: number;
  quantity: number;
  timestamp: string;
  profit?: number;
  status: OrderStatus;
  stopLoss?: number;
  takeProfit?: number;
}

export interface MarketData {
  symbol: string;
  category?: 'crypto' | 'stocks' | 'commodities';
  source?: 'TD' | 'STOOQ' | 'FINNHUB' | 'BINANCE';
  price: number;
  change: number;
  volume: number;
  timestamp: string;
}

export interface AISignal {
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reasoning: string;
  suggestedStopLoss: number;
  suggestedTakeProfit: number;
  targetPrice?: number;
}

export interface Portfolio {
  balance: number;
  equity: number;
  openPositions: Trade[];
  history: Trade[];
}

export interface NewsItem {
  id: string;
  source: string;
  headline: string;
  time: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  impact?: 'high' | 'medium' | 'low';
}

export interface EventItem {
  id: string;
  title: string;
  time: string;
  importance: 'high' | 'medium' | 'low';
  country?: string;
  forecast?: string;
  previous?: string;
}

export interface RiskSettings {
  autoHedge: boolean;
  dailyLossLimit: number;
  globalStopLoss: number;
  trailingStop: boolean;
  aiOverride: boolean;
}
