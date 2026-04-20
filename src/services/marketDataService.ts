/**
 * marketDataService.ts
 * Real market data via:
 *  - Twelve Data REST API (stocks, crypto, commodities, forex) — polled every 15s
 *  - Binance WebSocket — real-time crypto tick streaming
 *  - Finnhub WebSocket — real-time stock tick streaming
 */

export interface LiveQuote {
  symbol: string;
  category: 'crypto' | 'stocks' | 'commodities';
  source: 'TD' | 'STOOQ' | 'FINNHUB' | 'BINANCE' | 'YAHOO';
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
  NFLX:   'NFLX',
  AMD:    'AMD',
  INTC:   'INTC',
  CRM:    'CRM',
  ORCL:   'ORCL',
  QCOM:   'QCOM',
  AVGO:   'AVGO',
  JPM:    'JPM',
  V:      'V',
  GS:     'GS',
  JNJ:    'JNJ',
  UNH:    'UNH',
  WMT:    'WMT',
  DIS:    'DIS',
  KO:     'KO',
  PEP:    'PEP',
  HD:     'HD',
  NKE:    'NKE',
  BA:     'BA',
  PYPL:   'PYPL',
  XAUUSD: 'XAU/USD',
  XAGUSD: 'XAG/USD',
  USOIL:  'WTI',
  BRENT:  'BRENT',
  NATGAS: 'NG',
  COPPER: 'COPPER',
  PLATINUM:  'PLATINUM',
  PALLADIUM: 'PALLADIUM',
  WHEAT:   'WHEAT',
  CORN:    'CORN',
  SOYBEAN: 'SOYBEAN',
  COFFEE:  'COFFEE',
  SUGAR:   'SUGAR',
  COCOA:   'COCOA',
  COTTON:  'COTTON',
  OJ:      'OJ',
  GASOLINE: 'GASOLINE',
  HEATING:  'HEATING',
  CATTLE:   'CATTLE',
  HOGS:     'HOGS',
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
const TD_BATCH_SIZE = 40;
const TD_DEFAULT_COMMODITIES = new Set([
  'XAU/USD', 'XAG/USD', 'WTI', 'BRENT', 'NG', 'COPPER',
  'PLATINUM', 'PALLADIUM', 'WHEAT', 'CORN', 'SOYBEAN',
  'COFFEE', 'SUGAR', 'COCOA', 'COTTON', 'OJ',
  'GASOLINE', 'HEATING', 'CATTLE', 'HOGS',
]);
const TD_TO_STOOQ_COMMODITY: Record<string, string> = {
  'XAU/USD': 'XAUUSD',
  'XAG/USD': 'XAGUSD',
  WTI: 'CL.F',
  NG: 'NG.F',
  COPPER: 'HG.F',
};
const ALL_COMMODITY_APP_SYMBOLS = [
  'XAUUSD', 'XAGUSD', 'USOIL', 'BRENT', 'NATGAS', 'COPPER',
  'PLATINUM', 'PALLADIUM', 'WHEAT', 'CORN', 'SOYBEAN',
  'COFFEE', 'SUGAR', 'COCOA', 'COTTON', 'OJ',
  'GASOLINE', 'HEATING', 'CATTLE', 'HOGS',
];
const DEFAULT_SEED_PRICES: Record<string, number> = {
  AAPL: 198, TSLA: 247, NVDA: 875, MSFT: 378, AMZN: 182, GOOGL: 156, META: 498,
  NFLX: 950, AMD: 165, INTC: 28, CRM: 340, ORCL: 190, QCOM: 185, AVGO: 1850,
  JPM: 245, V: 310, GS: 520, JNJ: 165, UNH: 590,
  WMT: 95, DIS: 115, KO: 72, PEP: 175, HD: 405, NKE: 80, BA: 195, PYPL: 78,
  XAUUSD: 4833, XAGUSD: 80, USOIL: 86.4, BRENT: 94, NATGAS: 2.69, COPPER: 6.05,
  PLATINUM: 2084, PALLADIUM: 1562, WHEAT: 603, CORN: 457, SOYBEAN: 1166,
  COFFEE: 287, SUGAR: 13.4, COCOA: 3421, COTTON: 79.3, OJ: 185,
  GASOLINE: 3.01, HEATING: 3.43, CATTLE: 247, HOGS: 101,
};
const STOCK_PRIORITY = ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN', 'GOOGL', 'META',
  'NFLX', 'AMD', 'INTC', 'CRM', 'ORCL', 'QCOM', 'AVGO',
  'JPM', 'V', 'GS', 'JNJ', 'UNH',
  'WMT', 'DIS', 'KO', 'PEP', 'HD', 'NKE', 'BA', 'PYPL'];
const STOCK_FALLBACK_BATCH_SIZE = 25;
let stockFallbackCursor = 0;
let preferredStockSymbols: string[] = [];

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function parsePriceResponse(json: any, tdSymbols: string[]): Record<string, { price: number; change: number; volume: number }> {
  const toNum = (v: any): number => {
    const n = parseFloat(v ?? '');
    return Number.isFinite(n) ? n : Number.NaN;
  };
  const result: Record<string, { price: number; change: number; volume: number }> = {};
  if (tdSymbols.length === 1) {
    const sym = tdSymbols[0];
    const price = toNum(json?.price ?? json?.close);
    if (!isNaN(price)) {
      const change = toNum(json?.percent_change ?? json?.change_percent ?? json?.change);
      const volume = toNum(json?.volume);
      result[sym] = {
        price,
        change: Number.isFinite(change) ? change : Number.NaN,
        volume: Number.isFinite(volume) ? volume : 0,
      };
    }
  } else {
    for (const [sym, data] of Object.entries(json ?? {})) {
      const d = data as any;
      const price = toNum(d?.price ?? d?.close);
      if (!isNaN(price)) {
        const change = toNum(d?.percent_change ?? d?.change_percent ?? d?.change);
        const volume = toNum(d?.volume);
        result[sym] = {
          price,
          change: Number.isFinite(change) ? change : Number.NaN,
          volume: Number.isFinite(volume) ? volume : 0,
        };
      }
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
  const result: Record<string, { price: number; change: number; volume: number }> = {};
  for (const chunk of chunkArray(tdSymbols, TD_BATCH_SIZE)) {
    const symbolsParam = chunk.join(',');
    let parsed: Record<string, { price: number; change: number; volume: number }> = {};
    try {
      const proxyRes = await fetch(`/api/proxy/quotes?symbols=${encodeURIComponent(symbolsParam)}`);
      if (proxyRes.ok) parsed = parsePriceResponse(await proxyRes.json(), chunk);
    } catch { /* proxy not available */ }

    if (Object.keys(parsed).length === 0 && API_KEY) {
      try {
        const url = `${TD_BASE}/quote?symbol=${encodeURIComponent(symbolsParam)}&apikey=${API_KEY}`;
        const res = await fetch(url);
        if (res.ok) parsed = parsePriceResponse(await res.json(), chunk);
      } catch { /* API unavailable */ }
    }
    Object.assign(result, parsed);
  }
  return result;
}

async function fetchTwelveDataEod(tdSymbols: string[]) {
  const result: Record<string, number> = {};
  for (const chunk of chunkArray(tdSymbols, TD_BATCH_SIZE)) {
    const symbolsParam = chunk.join(',');
    let parsed: Record<string, number> = {};
    try {
      const proxyRes = await fetch(`/api/proxy/eod?symbols=${encodeURIComponent(symbolsParam)}`);
      if (proxyRes.ok) parsed = parseEodResponse(await proxyRes.json(), chunk);
    } catch { /* proxy not available */ }

    if (Object.keys(parsed).length === 0 && API_KEY) {
      try {
        const url = `${TD_BASE}/eod?symbol=${encodeURIComponent(symbolsParam)}&apikey=${API_KEY}`;
        const res = await fetch(url);
        if (res.ok) parsed = parseEodResponse(await res.json(), chunk);
      } catch { /* API unavailable */ }
    }
    Object.assign(result, parsed);
  }
  return result;
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

async function fetchFinnhubStockPrices(symbols: string[]): Promise<Record<string, { price: number; change: number; volume: number }>> {
  const result: Record<string, { price: number; change: number; volume: number }> = {};
  if (symbols.length === 0) return result;

  try {
    const proxyRes = await fetch(`/api/proxy/stocks-quote?symbols=${encodeURIComponent(symbols.join(','))}`);
    if (proxyRes.ok) {
      const json = await proxyRes.json();
      const rows = (json?.data ?? []) as Array<{ symbol: string; price: number; change: number; volume: number }>;
      rows.forEach((r) => {
        if (!r?.symbol || !Number.isFinite(r.price) || r.price <= 0) return;
        result[r.symbol] = { price: r.price, change: Number(r.change) || 0, volume: Number(r.volume) || 0 };
      });
      if (Object.keys(result).length > 0) return result;
    }
  } catch {
    // Continue to direct fallback.
  }

  if (!FINNHUB_KEY || FINNHUB_KEY.includes('YOUR_FINNHUB')) return result;
  await Promise.all(
    symbols.slice(0, 60).map(async (sym) => {
      try {
        const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${FINNHUB_KEY}`;
        const r = await fetch(url);
        if (!r.ok) return;
        const j = await r.json();
        const price = Number(j?.c || 0);
        if (!Number.isFinite(price) || price <= 0) return;
        result[sym] = { price, change: Number(j?.dp || 0), volume: 0 };
      } catch {
        // Ignore per-symbol failures.
      }
    }),
  );
  return result;
}

async function fetchStooqCommodityPrices(tdCommoditySymbols: string[]): Promise<Record<string, { price: number; change: number; volume: number }>> {
  const result: Record<string, { price: number; change: number; volume: number }> = {};
  const pairs = tdCommoditySymbols
    .map((td) => ({ td, stooq: TD_TO_STOOQ_COMMODITY[td] }))
    .filter((x) => !!x.stooq) as Array<{ td: string; stooq: string }>;
  if (pairs.length === 0) return result;

  const symbolsParam = pairs.map((p) => p.stooq).join(',');
  try {
    const proxyRes = await fetch(`/api/proxy/stooq-quote?market=commodities&symbols=${encodeURIComponent(symbolsParam)}`);
    if (!proxyRes.ok) return result;
    const json = await proxyRes.json();
    const rows = (json?.data ?? []) as Array<{ symbol: string; price: number; change: number; volume: number }>;
    const byStooq: Record<string, { price: number; change: number; volume: number }> = {};
    rows.forEach((r) => {
      if (!r?.symbol || !Number.isFinite(r.price) || r.price <= 0) return;
      byStooq[r.symbol] = { price: r.price, change: Number(r.change) || 0, volume: Number(r.volume) || 0 };
    });
    pairs.forEach((p) => {
      if (byStooq[p.stooq]) result[p.td] = byStooq[p.stooq];
    });
  } catch {
    // Ignore network/transient errors.
  }
  return result;
}

async function fetchStooqStockPrices(symbols: string[]): Promise<Record<string, { price: number; change: number; volume: number }>> {
  const result: Record<string, { price: number; change: number; volume: number }> = {};
  if (symbols.length === 0) return result;

  try {
    const proxyRes = await fetch(`/api/proxy/stooq-quote?market=stocks&symbols=${encodeURIComponent(symbols.join(','))}`);
    if (!proxyRes.ok) return result;
    const json = await proxyRes.json();
    const rows = (json?.data ?? []) as Array<{ symbol: string; price: number; change: number; volume: number }>;
    rows.forEach((r) => {
      if (!r?.symbol || !Number.isFinite(r.price) || r.price <= 0) return;
      result[r.symbol] = { price: Number(r.price), change: Number(r.change) || 0, volume: Number(r.volume) || 0 };
    });
  } catch {
    // Ignore network/transient errors.
  }
  return result;
}

async function fetchYahooStockPrices(symbols: string[]): Promise<Record<string, { price: number; change: number; volume: number }>> {
  const result: Record<string, { price: number; change: number; volume: number }> = {};
  if (symbols.length === 0) return result;

  try {
    const proxyRes = await fetch(`/api/proxy/yahoo-stocks?symbols=${encodeURIComponent(symbols.join(','))}`);
    if (!proxyRes.ok) return result;
    const json = await proxyRes.json();
    const rows = (json?.data ?? []) as Array<{ symbol: string; price: number; change: number; volume: number }>;
    rows.forEach((r) => {
      if (!r?.symbol || !Number.isFinite(r.price) || r.price <= 0) return;
      result[r.symbol] = { price: r.price, change: Number(r.change) || 0, volume: Number(r.volume) || 0 };
    });
  } catch {
    // Ignore network/transient errors.
  }
  return result;
}

async function fetchYahooCommodityPrices(appSymbols: string[]): Promise<Record<string, { price: number; change: number; volume: number }>> {
  const result: Record<string, { price: number; change: number; volume: number }> = {};
  if (appSymbols.length === 0) return result;

  try {
    const proxyRes = await fetch(`/api/proxy/yahoo-commodities?symbols=${encodeURIComponent(appSymbols.join(','))}`);
    if (!proxyRes.ok) return result;
    const json = await proxyRes.json();
    const rows = (json?.data ?? []) as Array<{ symbol: string; price: number; change: number; volume: number }>;
    rows.forEach((r) => {
      if (!r?.symbol || !Number.isFinite(r.price) || r.price <= 0) return;
      result[r.symbol] = { price: r.price, change: Number(r.change) || 0, volume: Number(r.volume) || 0 };
    });
  } catch {
    // Ignore network/transient errors.
  }
  return result;
}

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
  const stockEntries = stockCommodityEntries.filter(([, td]) => !(TD_DEFAULT_COMMODITIES.has(td) || td.includes('/')));
  const commodityEntries = stockCommodityEntries.filter(([, td]) => TD_DEFAULT_COMMODITIES.has(td) || td.includes('/'));
  const allStockAppSymbols = stockEntries.map(([app]) => app);
  const commodityTdSymbols = commodityEntries.map(([, td]) => td);
  const cryptoSymbols = Object.keys(BINANCE_STREAMS);

  const stockWindow =
    allStockAppSymbols.length <= STOCK_FALLBACK_BATCH_SIZE
      ? allStockAppSymbols
      : [
          ...allStockAppSymbols.slice(stockFallbackCursor, stockFallbackCursor + STOCK_FALLBACK_BATCH_SIZE),
          ...allStockAppSymbols.slice(0, Math.max(0, stockFallbackCursor + STOCK_FALLBACK_BATCH_SIZE - allStockAppSymbols.length)),
        ];
  stockFallbackCursor = allStockAppSymbols.length > 0
    ? (stockFallbackCursor + STOCK_FALLBACK_BATCH_SIZE) % allStockAppSymbols.length
    : 0;
  const stockAppSymbols = Array.from(new Set([...preferredStockSymbols, ...STOCK_PRIORITY, ...stockWindow]));
  const stockTdSymbols = stockAppSymbols
    .map((app) => TD_SYMBOLS[app])
    .filter((td): td is string => Boolean(td));
  const tdSymbolsForQuote = Array.from(new Set([...commodityTdSymbols, ...stockTdSymbols]));

  if (Object.keys(prevCloseCache).length === 0) {
    const tdSymbolsForEod = Array.from(new Set([...commodityTdSymbols, ...STOCK_PRIORITY.map((s) => TD_SYMBOLS[s]).filter(Boolean)]));
    prevCloseCache = await fetchTwelveDataEod(tdSymbolsForEod);
  }

  const commodityAppSymbols = commodityEntries.map(([app]) => app);

  const [prices, cryptoPrices, yahooStockPrices, yahooCommodityPrices, stockFallbackFinnhub, stockFallbackStooq, commodityFallback] = await Promise.all([
    fetchTwelveDataBatch(tdSymbolsForQuote),
    fetchBinancePrices(cryptoSymbols),
    fetchYahooStockPrices(stockAppSymbols),
    fetchYahooCommodityPrices(commodityAppSymbols),
    fetchFinnhubStockPrices(stockAppSymbols),
    fetchStooqStockPrices(stockAppSymbols),
    fetchStooqCommodityPrices(commodityTdSymbols),
  ]);
  const result: Record<string, LiveQuote> = {};

  for (const [appSym, tdSym] of stockCommodityEntries) {
    const live = prices[tdSym];
    const isCommod = TD_DEFAULT_COMMODITIES.has(tdSym) || tdSym.includes('/');
    const providerFallback = isCommod
      ? (yahooCommodityPrices[appSym] ?? commodityFallback[tdSym])
      : (yahooStockPrices[appSym] ?? stockFallbackFinnhub[appSym] ?? stockFallbackStooq[appSym]);
    const cached = priceCache[appSym] ?? DEFAULT_SEED_PRICES[appSym];
    const mergedLive = live ?? providerFallback ?? (cached ? { price: cached, change: 0, volume: 0 } : undefined);
    if (!mergedLive) continue;
    const source: LiveQuote['source'] = live
      ? 'TD'
      : isCommod
        ? (yahooCommodityPrices[appSym] ? 'YAHOO' : 'STOOQ')
        : (yahooStockPrices[appSym] ? 'YAHOO' : stockFallbackFinnhub[appSym] ? 'FINNHUB' : 'STOOQ');

    const prevClose = prevCloseCache[tdSym] ?? mergedLive.price;
    const change = Number.isFinite(mergedLive.change)
      ? mergedLive.change
      : (prevClose ? ((mergedLive.price - prevClose) / prevClose) * 100 : 0);

    priceCache[appSym] = mergedLive.price;
    result[appSym] = {
      symbol: appSym,
      category: TD_DEFAULT_COMMODITIES.has(tdSym) || tdSym.includes('/') ? 'commodities' : 'stocks',
      source,
      price: mergedLive.price,
      change,
      volume: mergedLive.volume,
      timestamp: new Date().toISOString(),
    };
  }

  for (const symbol of cryptoSymbols) {
    const live = cryptoPrices[symbol];
    if (!live) continue;
    priceCache[symbol] = live.price;
    result[symbol] = {
      symbol,
      category: 'crypto',
      source: 'BINANCE',
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

export function setPreferredStockSymbols(symbols: string[]) {
  preferredStockSymbols = Array.from(
    new Set(
      symbols
        .map((s) => String(s || '').toUpperCase())
        .filter((s) => /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(s)),
    ),
  ).slice(0, 120);
}

export { BINANCE_STREAMS, TD_SYMBOLS };
