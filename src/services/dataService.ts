import { NewsItem, EventItem } from '../types/trading';

const SAMPLE_NEWS: Partial<NewsItem>[] = [
  { source: "CryptoInsider", headline: "Bitcoin ETF Sees Record Inflows", sentiment: 'positive', impact: 'high' },
  { source: "MacroEcon", headline: "Federal Reserve Maintains Interest Rates", sentiment: 'neutral', impact: 'high' },
  { source: "DefiWeekly", headline: "Major Protocol Suffers Flash Loan Exploit", sentiment: 'negative', impact: 'high' },
  { source: "TradeAlert", headline: "Ethereum Network Upgrade Scheduled", sentiment: 'positive', impact: 'medium' },
  { source: "TechCrunch", headline: "AI Startups Driving Crypto Validation", sentiment: 'positive', impact: 'medium' },
  { source: "GlobalFinance", headline: "European Markets Open Lower on Inflation Data", sentiment: 'negative', impact: 'medium' },
  { source: "CoinDesk", headline: "Solana Transaction Volume Hits Monthly High", sentiment: 'positive', impact: 'medium' },
  { source: "Bloomberg", headline: "Institutional Investment in Digital Assets Climbs", sentiment: 'positive', impact: 'high' },
  { source: "Reuters", headline: "Regulatory Scrutiny Increases for Stablecoins", sentiment: 'negative', impact: 'high' }
];

const SAMPLE_EVENTS: Partial<EventItem>[] = [
  { title: "Non-Farm Payrolls", country: "US", importance: 'high', forecast: "180K", previous: "165K" },
  { title: "CPI Core y/y", country: "US", importance: 'high', forecast: "3.2%", previous: "3.3%" },
  { title: "ECB Interest Rate Decision", country: "EU", importance: 'high', forecast: "4.00%", previous: "4.00%" },
  { title: "Initial Jobless Claims", country: "US", importance: 'medium', forecast: "215K", previous: "212K" },
  { title: "Token Unlock: ARB", country: "Crypto", importance: 'low', previous: "N/A", forecast: "50M ARB" },
  { title: "Mainnet Beta Launch", country: "Crypto", importance: 'medium', previous: "-", forecast: "On Track" },
];

export async function fetchLiveNews(): Promise<NewsItem[]> {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Pick 3-5 random news items
  const count = Math.floor(Math.random() * 3) + 3;
  const shuffled = [...SAMPLE_NEWS].sort(() => 0.5 - Math.random());
  
  return shuffled.slice(0, count).map(news => ({
    id: Math.random().toString(36).substr(2, 9),
    source: news.source!,
    headline: news.headline!,
    sentiment: news.sentiment!,
    impact: news.impact!,
    time: "Just now"
  }));
}

export async function fetchUpcomingEvents(): Promise<EventItem[]> {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 300));
  
  // Pick 3-4 random events
  const count = Math.floor(Math.random() * 2) + 3;
  const shuffled = [...SAMPLE_EVENTS].sort(() => 0.5 - Math.random());
  
  return shuffled.slice(0, count).map(event => {
    const minutes = Math.floor(Math.random() * 60) + 10;
    return {
      id: Math.random().toString(36).substr(2, 9),
      title: event.title!,
      importance: event.importance!,
      country: event.country,
      forecast: event.forecast,
      previous: event.previous,
      time: `In ${minutes}m`
    };
  });
}

export interface PythonMarketStats {
  symbol: string;
  current_price: number;
  sma_7: number;
  annualized_volatility: number;
  max_drawdown_30d: number;
  data_points: number;
}

/**
 * Generates mock BTC market stats locally — mirrors the Python FastAPI backend logic.
 * This removes the need to run the Python server; no proxy / ECONNREFUSED errors.
 */
export async function fetchPythonMarketStats(): Promise<PythonMarketStats | null> {
  // Seeded random walk (seed=42 equivalent via a simple LCG so values are stable-ish)
  const seed42 = () => {
    let s = 42;
    return () => {
      s = (s * 1664525 + 1013904223) & 0xffffffff;
      // Map to [0, 1)
      return (s >>> 0) / 4294967296;
    };
  };
  const rand = seed42();
  const randNormal = () => {
    // Box-Muller transform
    const u = Math.max(1e-10, rand());
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const N = 30;
  const prices: number[] = [];
  let cumReturn = 0;
  for (let i = 0; i < N; i++) {
    cumReturn += 0.001 + 0.02 * randNormal();
    prices.push(60000 * Math.exp(cumReturn));
  }

  // SMA-7 of last 7 prices
  const sma7 = prices.slice(-7).reduce((a, b) => a + b, 0) / 7;

  // Daily returns
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const volatility = Math.sqrt(variance) * Math.sqrt(365);

  const maxPrice = Math.max(...prices);
  const minPrice = Math.min(...prices);
  const maxDrawdown = (maxPrice - minPrice) / maxPrice;
  const latestPrice = prices[prices.length - 1];

  return {
    symbol: 'BTC',
    current_price: Math.round(latestPrice * 100) / 100,
    sma_7: Math.round(sma7 * 100) / 100,
    annualized_volatility: Math.round(volatility * 10000) / 10000,
    max_drawdown_30d: Math.round(maxDrawdown * 10000) / 10000,
    data_points: N,
  };
}
