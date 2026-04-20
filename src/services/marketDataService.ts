/**
 * marketDataService.ts
 * Real market data via:
 *  - Twelve Data REST API (stocks, crypto, commodities, forex) — polled every 15s
 *  - Binance WebSocket — real-time crypto tick streaming
 *  - Finnhub WebSocket — real-time stock tick streaming
 */

export interface LiveQuote {
  symbol: string;
  price: number;
  change: number;      // % change from previous close
  volume: number;
  timestamp: string;
}

// ── Symbol config ─────────────────────────────────────────────────────────────

const TD_SYMBOLS: Record<string, string> = {
  AAPL:   'AAPL',
  TSLA:   'TSLA',
  NVDA:   'NVDA',
  MSFT:   'MSFT',
  AMZN:   'AMZN',
  GOOGL:  'GOOGL',
  META:   'META',
  XAUUSD: 'XAU/USD',
  XAGUSD: 'XAG/USD',
  USOIL:  'WTI',
  NATGAS: 'NG',
  COPPER: 'COPPER',
};

const BINANCE_STREAMS: Record<string, string> = {
  BTC: 'btcusdt',
  ETH: 'ethusdt',
  SOL: 'solusdt',
  BNB: 'bnbusdt',
  XRP: 'xrpusdt',
  ADA: 'adausdt',
};

// ── Twelve Data REST ──────────────────────────────────────────────────────────

const TD_BASE = 'https://api.twelvedata.com';
const API_KEY = import.meta.env.VITE_TWELVE_DATA_KEY as string;
const BINANCE_REST_BASE = 'https://api.binance.com';

function parsePriceResponse(json: any, tdSymbols: string[]): Record<string, { price: number; change: number; volume: number }> {
  const result: Record<string, { price: number; change: number; volume: number }> = {};
  if (tdSymbols.length === 1) {
    const sym = tdSymbols[0];
    const price = parseFloat(json?.price ?? '');
    if (!isNaN(price)) result[sym] = { price, change: 0, volume: 0 };
  } else {
    for (const [sym, data] of Object.entries(json ?? {})) {
      const d = data as any;
      const price = parseFloat(d?.price ?? '');
      if (!isNaN(price)) result[sym] = { price, change: 0, volume: 0 };
    }
  }
  return result;
}

function parseEodResponse(json: any, tdSymbols: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  if (tdSymbols.length === 1) {
    const sym = tdSymbols[0];
    const close = parseFloat(json?.close ?? '');
    if (!isNaN(close)) result[sym] = close;
  } else {
    for (const [sym, data] of Object.entries(json ?? {})) {
      const close = parseFloat((data as any)?.close ?? '');
      if (!isNaN(close)) result[sym] = close;
    }
  }
  return result;
}

async function fetchTwelveDataBatch(tdSymbols: string[]) {
  const symbolsParam = tdSymbols.join(',');
  try {
    const proxyRes = await fetch(`/api/proxy/quotes?symbols=${encodeURIComponent(symbolsParam)}`);
    if (proxyRes.ok) {
      const json = await proxyRes.json();
      const parsed = parsePriceResponse(json, tdSymbols);
      if (Object.keys(parsed).length > 0) return parsed;
    }
  } catch { /* proxy not available */ }

  if (API_KEY) {
    try {
      const url = `${TD_BASE}/price?symbol=${encodeURIComponent(symbolsParam)}&apikey=${API_KEY}`;
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        const parsed = parsePriceResponse(json, tdSymbols);
        if (Object.keys(parsed).length > 0) return parsed;
      }
    } catch { /* API unavailable */ }
  }
  return {};
}

async function fetchTwelveDataEod(tdSymbols: string[]) {
  const symbolsParam = tdSymbols.join(',');
  try {
    const proxyRes = await fetch(`/api/proxy/eod?symbols=${encodeURIComponent(symbolsParam)}`);
    if (proxyRes.ok) {
      const json = await proxyRes.json();
      const parsed = parseEodResponse(json, tdSymbols);
      if (Object.keys(parsed).length > 0) return parsed;
    }
  } catch { /* proxy not available */ }

  if (API_KEY) {
    try {
      const url = `${TD_BASE}/eod?symbol=${encodeURIComponent(symbolsParam)}&apikey=${API_KEY}`;
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        const parsed = parseEodResponse(json, tdSymbols);
        if (Object.keys(parsed).length > 0) return parsed;
      }
    } catch { /* API unavailable */ }
  }
  return {};
}

async function fetchBinancePrices(symbols: string[]): Promise<Record<string, { price: number; change: number; volume: number }>> {
  const result: Record<string, { price: number; change: number; volume: number }> = {};
  const pairs = symbols.map((s) => `${s}USDT`);
  if (pairs.length === 0) return result;

  try {
    const res = await fetch(`${BINANCE_REST_BASE}/api/v3/ticker/24hr`);
    if (!res.ok) return result;
    const data = (await res.json()) as Array<{
      symbol: string;
      lastPrice: string;
      priceChangePercent: string;
      quoteVolume: string;
    }>;
    data.forEach((row) => {
      if (!pairs.includes(row.symbol)) return;
      const appSymbol = row.symbol.replace('USDT', '');
      const price = parseFloat(row.lastPrice);
      const change = parseFloat(row.priceChangePercent);
      const volume = parseFloat(row.quoteVolume);
      if (!isNaN(price)) {
        result[appSymbol] = {
          price,
          change: isNaN(change) ? 0 : change,
          volume: isNaN(volume) ? 0 : volume,
        };
      }
    });
  } catch {
    // Ignore network/transient errors.
  }

  return result;
}

// ── WebSockets (Binance & Finnhub) ────────────────────────────────────────────

type TickCallback = (symbol: string, price: number) => void;

let binanceWs: WebSocket | null = null;
const binanceSubscribers = new Set<TickCallback>();
let binanceReconnectTimeout: any = null;

export const BINANCE_API_KEY = import.meta.env.VITE_BINANCE_API_KEY as string;

export function connectBinanceWebSocket(symbols: string[], onTick: TickCallback): () => void {
  binanceSubscribers.add(onTick);

  if (!binanceWs || binanceWs.readyState === WebSocket.CLOSED) {
    const streams = symbols.map(s => `${s.toLowerCase()}usdt@trade`).join('/');
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    function connect() {
      if (binanceWs && binanceWs.readyState !== WebSocket.CLOSED) return;
      binanceWs = new WebSocket(url);
      binanceWs.onopen = () => console.log(`[MarketData] ✓ Binance WebSocket connected`);
      binanceWs.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          const trade = msg.data;
          if (!trade?.s || !trade?.p) return;
          const appSym = trade.s.replace('USDT', '');
          const price = parseFloat(trade.p);
          binanceSubscribers.forEach(cb => cb(appSym, price));
        } catch { /* ignore */ }
      };
      binanceWs.onclose = () => {
        binanceWs = null;
        if (binanceSubscribers.size > 0) binanceReconnectTimeout = setTimeout(connect, 3000);
      };
    }
    connect();
  }

  return () => {
    binanceSubscribers.delete(onTick);
    if (binanceSubscribers.size === 0) {
      if (binanceReconnectTimeout) clearTimeout(binanceReconnectTimeout);
      if (binanceWs) {
        binanceWs.onclose = null;
        binanceWs.close();
        binanceWs = null;
      }
    }
  };
}

const FINNHUB_KEY = import.meta.env.VITE_FINNHUB_KEY as string;
let finnhubWs: WebSocket | null = null;
const finnhubSubscribers = new Set<TickCallback>();
let finnhubReconnectTimeout: any = null;

export function connectFinnhubWebSocket(symbols: string[], onTick: TickCallback): () => void {
  let validKey = FINNHUB_KEY || '';
  if (validKey.length > 20 && !validKey.includes('-')) validKey = validKey.slice(0, 20);

  if (!validKey || validKey.includes('YOUR_FINNHUB')) return () => {};

  finnhubSubscribers.add(onTick);

  if (!finnhubWs || finnhubWs.readyState === WebSocket.CLOSED) {
    const url = `wss://ws.finnhub.io?token=${validKey}`;
    
    function connect() {
      if (finnhubWs && finnhubWs.readyState !== WebSocket.CLOSED) return;
      finnhubWs = new WebSocket(url);
      finnhubWs.onopen = () => {
        console.log('[MarketData] ✓ Finnhub WebSocket connected');
        symbols.forEach(s => finnhubWs?.send(JSON.stringify({ type: 'subscribe', symbol: s })));
      };
      finnhubWs.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'trade') {
            msg.data.forEach((trade: any) => {
              finnhubSubscribers.forEach(cb => cb(trade.s, trade.p));
            });
          }
        } catch { /* ignore */ }
      };
      finnhubWs.onclose = () => {
        finnhubWs = null;
        if (finnhubSubscribers.size > 0) finnhubReconnectTimeout = setTimeout(connect, 5000);
      };
    }
    connect();
  } else if (finnhubWs.readyState === WebSocket.OPEN) {
    symbols.forEach(s => finnhubWs?.send(JSON.stringify({ type: 'subscribe', symbol: s })));
  }

  return () => {
    finnhubSubscribers.delete(onTick);
    if (finnhubSubscribers.size === 0) {
      if (finnhubReconnectTimeout) clearTimeout(finnhubReconnectTimeout);
      if (finnhubWs) {
        finnhubWs.onclose = null;
        finnhubWs.close();
        finnhubWs = null;
      }
    }
  };
}

// ── Twelve Data REST Polling ──────────────────────────────────────────────────

const priceCache: Record<string, number> = {};
let prevCloseCache: Record<string, number> = {};
let lastFetchTime = 0;
let lastResult: Record<string, LiveQuote> = {};
const MIN_FETCH_INTERVAL_MS = 4_500;

export async function fetchAllLiveQuotes(): Promise<Record<string, LiveQuote>> {
  const now = Date.now();
  if (now - lastFetchTime < MIN_FETCH_INTERVAL_MS && Object.keys(lastResult).length > 0) {
    return lastResult;
  }

  const stockCommodityEntries = Object.entries(TD_SYMBOLS).filter(([appSym]) => !BINANCE_STREAMS[appSym]);
  const tdSymsList = stockCommodityEntries.map(([, td]) => td);
  const cryptoSymbols = Object.keys(BINANCE_STREAMS);

  if (Object.keys(prevCloseCache).length === 0) {
    prevCloseCache = await fetchTwelveDataEod(tdSymsList);
  }

  const [prices, cryptoPrices] = await Promise.all([
    fetchTwelveDataBatch(tdSymsList),
    fetchBinancePrices(cryptoSymbols),
  ]);
  const result: Record<string, LiveQuote> = {};

  if (Object.keys(prices).length > 0) {
    for (const [appSym, tdSym] of stockCommodityEntries) {
      const live = prices[tdSym];
      if (!live) continue;
      const prevClose = prevCloseCache[tdSym] ?? live.price;
      const change = prevClose ? ((live.price - prevClose) / prevClose) * 100 : 0;
      priceCache[appSym] = live.price;
      result[appSym] = {
        symbol: appSym,
        price: live.price,
        change,
        volume: 0,
        timestamp: new Date().toISOString(),
      };
    }
  }

  for (const symbol of cryptoSymbols) {
    const live = cryptoPrices[symbol];
    if (!live) continue;
    priceCache[symbol] = live.price;
    result[symbol] = {
      symbol,
      price: live.price,
      change: live.change,
      volume: live.volume,
      timestamp: new Date().toISOString(),
    };
  }

  if (Object.keys(result).length === 0) return lastResult;

  if (Object.keys(result).length > 0) {
    lastResult = result;
    lastFetchTime = now;
  }
  return result;
}

export function getCachedPrice(symbol: string): number | undefined {
  return priceCache[symbol];
}

export { BINANCE_STREAMS, TD_SYMBOLS };
