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

export async function fetchPythonMarketStats(): Promise<PythonMarketStats | null> {
  try {
    const res = await fetch('/api/python/market-stats');
    if (!res.ok) throw new Error('Network response was not ok');
    const data = await res.json();
    return data;
  } catch (error) {
    console.error('Failed to fetch from Python backend:', error);
    return null;
  }
}
