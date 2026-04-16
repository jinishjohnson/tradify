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
