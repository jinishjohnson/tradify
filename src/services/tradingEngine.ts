import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MarketData, Portfolio, Trade, AISignal, RiskSettings } from '../types/trading';
import { getTradingSignal } from './aiService';
import { connectBinanceWebSocket, fetchAllLiveQuotes, connectFinnhubWebSocket, BINANCE_API_KEY } from './marketDataService';

// Per-symbol cooldown: don't re-analyze a symbol within this window
const SYMBOL_COOLDOWN_MS = 90_000; // 90 seconds

const INITIAL_BALANCE = 10000;

export function useTradingEngine() {
  const [portfolio, setPortfolio] = useState<Portfolio>({
    balance: INITIAL_BALANCE,
    equity: INITIAL_BALANCE,
    openPositions: [],
    history: [],
  });
  const [marketData, setMarketData] = useState<MarketData[]>([]);
  const [isBotRunning, setIsBotRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [riskSettings, setRiskSettings] = useState<RiskSettings>({
    autoHedge: false,
    dailyLossLimit: 5,
    globalStopLoss: 2,
    trailingStop: true,
    aiOverride: false
  });

  // Refs so interval closures always see the latest values without re-running effects
  const marketDataRef = useRef<MarketData[]>([]);
  const portfolioRef = useRef<Portfolio>({ balance: INITIAL_BALANCE, equity: INITIAL_BALANCE, openPositions: [], history: [] });
  const symbolCooldownRef = useRef<Map<string, number>>(new Map());
  const priceHistory = useRef<Record<string, number[]>>({});
  const pendingUpdates = useRef<Record<string, number>>({});

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 50));
  }, []);

  // ── Real Market Data Integration ─────────────────────────────────────────
  // Crypto: Binance WebSocket (real-time, no key)
  // Stocks/Commodities: Twelve Data REST every few seconds
  // Crypto fallback: Binance REST when WebSocket is unavailable

  const BASE_MAP: Record<string, number> = {
    // Crypto (Binance WebSocket overrides these immediately)
    BTC: 75000, ETH: 1580, SOL: 130, BNB: 590, XRP: 2.15, ADA: 0.62,
    // Stocks (Twelve Data overrides these every 15s)
    AAPL: 198, TSLA: 247, NVDA: 875, MSFT: 378, AMZN: 182, GOOGL: 156, META: 498,
    // Commodities — real April 2026 prices
    XAUUSD: 4792, XAGUSD: 32.5, USOIL: 62.4, NATGAS: 3.2, COPPER: 4.8,
  };

  const ALL_SYMBOLS = Object.keys(BASE_MAP);
  const HISTORY_WINDOW = 150;

  // Seed market data with BASE_MAP prices immediately so the UI isn't blank
  useEffect(() => {
    setMarketData(ALL_SYMBOLS.map(s => ({
      symbol: s,
      price: BASE_MAP[s],
      change: 0,
      volume: 0,
      timestamp: new Date().toISOString(),
    })));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Binance data → list all USDT pairs; stream most liquid subset in real time
  useEffect(() => {
    let disconnect = () => {};

    // 1) Fetch all traded USDT pairs
    const headers: Record<string, string> = {};
    if (BINANCE_API_KEY && !BINANCE_API_KEY.includes('YOUR_')) {
      headers['X-MBX-APIKEY'] = BINANCE_API_KEY;
    }

    fetch('https://api.binance.com/api/v3/ticker/24hr', { headers })
      .then(res => res.json())
      .then(data => {
        const usdtPairs = (data as any[])
          .filter((d: any) => d.symbol?.endsWith('USDT') && d.lastPrice)
          .sort((a: any, b: any) => parseFloat(b.quoteVolume || '0') - parseFloat(a.quoteVolume || '0'));

        const cryptoSymbols = usdtPairs.map((d: any) => d.symbol.replace('USDT', ''));
        const streamSymbols = cryptoSymbols.slice(0, 180);
        const fallbackSymbols = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA'];
        const displaySymbols = cryptoSymbols.length > 0 ? cryptoSymbols : fallbackSymbols;

        // 2) Initialize all pairs in market data immediately to avoid UI popping
        setMarketData(prev => {
          const existingSyms = new Set(prev.map(m => m.symbol));
          const tickMap = new Map(
            usdtPairs.map((d: any) => [d.symbol.replace('USDT', ''), d]),
          );
          const newItems = displaySymbols
            .filter((s: string) => !existingSyms.has(s))
            .map((s: string) => {
              const row = tickMap.get(s);
              const price = parseFloat(row?.lastPrice || '0');
              const change = parseFloat(row?.priceChangePercent || '0');
              const volume = parseFloat(row?.quoteVolume || '0');
              return {
                symbol: s,
                price: Number.isFinite(price) ? price : 0,
                change: Number.isFinite(change) ? change : 0,
                volume: Number.isFinite(volume) ? volume : 0,
                timestamp: new Date().toISOString()
              };
            });
          return [...prev, ...newItems];
        });

        // 3) Connect real-time stream for most liquid pairs only (connection-safe)
        disconnect = connectBinanceWebSocket(streamSymbols.length > 0 ? streamSymbols : fallbackSymbols, (symbol, price) => {
          pendingUpdates.current[symbol] = price;
        });
      })
      .catch(err => {
        console.error('Failed to fetch Binance crypto list:', err);
        // Fallback to hardcoded list if API fails
        disconnect = connectBinanceWebSocket(['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA'], (symbol, price) => {
          pendingUpdates.current[symbol] = price;
        });
      });

    return () => disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flush pending real-time updates every 250ms to prevent React update depth exceeded errors
  useEffect(() => {
    const interval = setInterval(() => {
      if (Object.keys(pendingUpdates.current).length === 0) return;
      
      setMarketData(prev => prev.map(m => {
        const newPrice = pendingUpdates.current[m.symbol];
        if (newPrice === undefined) return m;
        
        if (!priceHistory.current[m.symbol]) priceHistory.current[m.symbol] = [];
        priceHistory.current[m.symbol].push(newPrice);
        if (priceHistory.current[m.symbol].length > HISTORY_WINDOW) priceHistory.current[m.symbol].shift();
        
        const oldest = priceHistory.current[m.symbol][0] ?? newPrice;
        const change = ((newPrice / oldest) - 1) * 100;
        
        return { ...m, price: newPrice, change, timestamp: new Date().toISOString() };
      }));
      
      pendingUpdates.current = {};
    }, 250);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Finnhub WebSocket → update stock prices in real-time
  useEffect(() => {
    const stockSymbols = ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN', 'GOOGL', 'META'];
    const disconnect = connectFinnhubWebSocket(stockSymbols, (symbol, price) => {
      pendingUpdates.current[symbol] = price;
    });
    return disconnect;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Twelve Data/Binance REST fallback for all asset classes every 5s
  useEffect(() => {
    const poll = async () => {
      const quotes = await fetchAllLiveQuotes();
      if (Object.keys(quotes).length === 0) return; // rate-limited, keep existing
      setMarketData(prev => {
        const updated = prev.map(m => {
          const q = quotes[m.symbol];
          if (!q) return m;
          return { ...m, price: q.price, change: q.change, volume: q.volume, timestamp: q.timestamp };
        });
        const existing = new Set(updated.map(m => m.symbol));
        const additions = Object.values(quotes).filter(q => !existing.has(q.symbol));
        return additions.length > 0 ? [...updated, ...additions] : updated;
      });
    };

    poll(); // immediate first fetch
    const id = setInterval(poll, 5_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep refs in sync with state
  useEffect(() => { marketDataRef.current = marketData; }, [marketData]);
  useEffect(() => { portfolioRef.current = portfolio; }, [portfolio]);

  // Monitor SL/TP
  useEffect(() => {
    if (portfolio.openPositions.length === 0) return;

    const interval = setInterval(() => {
      setPortfolio(prev => {
        const remainingPositions: Trade[] = [];
        let balanceAdjustment = 0;
        const newHistoryRows: Trade[] = [];

        prev.openPositions.forEach(pos => {
          const current = marketData.find(m => m.symbol === pos.symbol);
          if (!current) {
            remainingPositions.push(pos);
            return;
          }

          let closed = false;
          let profit = 0;

          // Check Stop Loss
          if (pos.stopLoss && ((pos.side === 'BUY' && current.price <= pos.stopLoss) || (pos.side === 'SELL' && current.price >= pos.stopLoss))) {
            closed = true;
            profit = (current.price - pos.price) * pos.quantity * (pos.side === 'BUY' ? 1 : -1);
            addLog(`STOP LOSS triggered for ${pos.symbol} at $${current.price.toFixed(2)}. Profit: $${profit.toFixed(2)}`);
          }
          // Check Take Profit
          else if (pos.takeProfit && ((pos.side === 'BUY' && current.price >= pos.takeProfit) || (pos.side === 'SELL' && current.price <= pos.takeProfit))) {
            closed = true;
            profit = (current.price - pos.price) * pos.quantity * (pos.side === 'BUY' ? 1 : -1);
            addLog(`TAKE PROFIT triggered for ${pos.symbol} at $${current.price.toFixed(2)}. Profit: $${profit.toFixed(2)}`);
          }

          if (closed) {
            balanceAdjustment += (pos.price * pos.quantity) + profit;
            newHistoryRows.push({ ...pos, status: 'FILLED', profit });
          } else {
            remainingPositions.push(pos);
          }
        });

        if (newHistoryRows.length > 0) {
          return {
            ...prev,
            balance: prev.balance + balanceAdjustment,
            openPositions: remainingPositions,
            history: [...newHistoryRows, ...prev.history],
          };
        }
        return prev;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [marketData, portfolio.openPositions]);

  const executeTrade = useCallback(async (symbol: string) => {
    // Enforce per-symbol cooldown to avoid hammering the AI with the same symbol
    const lastAnalyzed = symbolCooldownRef.current.get(symbol) ?? 0;
    if (Date.now() - lastAnalyzed < SYMBOL_COOLDOWN_MS) {
      addLog(`[SKIP] ${symbol} analyzed recently — cooldown active`);
      return;
    }
    symbolCooldownRef.current.set(symbol, Date.now());

    const data = marketDataRef.current.find(m => m.symbol === symbol);
    if (!data) return;

    addLog(`AI analyzing ${symbol}...`);
    const signal = await getTradingSignal(data);
    addLog(`AI Signal for ${symbol}: ${signal.action} (Confidence: ${(signal.confidence * 100).toFixed(0)}%)`);

    if (signal.action === 'HOLD') return;

    const currentPortfolio = portfolioRef.current;
    const quantity = (currentPortfolio.balance * 0.1) / data.price;
    if (quantity <= 0 || currentPortfolio.balance < data.price * quantity) {
      addLog(`Insufficient funds for ${symbol}`);
      return;
    }

    const newTrade: Trade = {
      id: Math.random().toString(36).substr(2, 9),
      symbol,
      side: signal.action === 'BUY' ? 'BUY' : 'SELL',
      price: data.price,
      quantity,
      timestamp: new Date().toISOString(),
      status: 'PENDING',
      stopLoss: signal.suggestedStopLoss,
      takeProfit: signal.suggestedTakeProfit,
    };

    setPortfolio(prev => ({
      ...prev,
      balance: prev.balance - (newTrade.price * newTrade.quantity),
      openPositions: [...prev.openPositions, newTrade],
    }));

    addLog(`EXECUTED ${newTrade.side} ${symbol} at $${newTrade.price.toFixed(2)}`);
  }, [addLog]);

  /** Manual order — placed directly by the user (no AI required) */
  const executeManualTrade = useCallback((
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    stopLoss?: number,
    takeProfit?: number,
  ): { success: boolean; message: string } => {
    const data = marketDataRef.current.find(m => m.symbol === symbol);
    if (!data) return { success: false, message: 'Symbol not found in market data' };

    const cost = data.price * quantity;
    const currentPortfolio = portfolioRef.current;
    if (cost > currentPortfolio.balance) {
      return { success: false, message: `Insufficient funds (need $${cost.toFixed(2)}, have $${currentPortfolio.balance.toFixed(2)})` };
    }
    if (quantity <= 0) return { success: false, message: 'Quantity must be greater than 0' };

    const newTrade: Trade = {
      id: Math.random().toString(36).substr(2, 9),
      symbol,
      side,
      price: data.price,
      quantity,
      timestamp: new Date().toISOString(),
      status: 'FILLED',
      stopLoss,
      takeProfit,
    };

    setPortfolio(prev => ({
      ...prev,
      balance: prev.balance - cost,
      openPositions: [...prev.openPositions, newTrade],
    }));

    addLog(`MANUAL ${side} ${quantity.toFixed(4)} ${symbol} @ $${data.price.toFixed(2)}${stopLoss ? ` SL:${stopLoss.toFixed(2)}` : ''}${takeProfit ? ` TP:${takeProfit.toFixed(2)}` : ''}`);
    return { success: true, message: `${side} order filled at $${data.price.toFixed(2)}` };
  }, [addLog]);

  /** Close an open position immediately at market price */
  const closePosition = useCallback((positionId: string) => {
    setPortfolio(prev => {
      const pos = prev.openPositions.find(p => p.id === positionId);
      if (!pos) return prev;
      const current = marketDataRef.current.find(m => m.symbol === pos.symbol);
      const closePrice = current?.price ?? pos.price;
      const profit = (closePrice - pos.price) * pos.quantity * (pos.side === 'BUY' ? 1 : -1);
      const proceeds = pos.price * pos.quantity + profit;
      addLog(`CLOSED ${pos.side} ${pos.symbol} @ $${closePrice.toFixed(2)} | P&L: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`);
      return {
        ...prev,
        balance: prev.balance + proceeds,
        openPositions: prev.openPositions.filter(p => p.id !== positionId),
        history: [{ ...pos, status: 'FILLED', profit }, ...prev.history],
      };
    });
  }, [addLog]);

  // Automated Trading Loop
  // Only depends on isBotRunning — live data is read via refs to keep the interval stable
  useEffect(() => {
    if (!isBotRunning) return;

    const runAutomatedTrade = async () => {
      const currentPortfolio = portfolioRef.current;
      if (currentPortfolio.openPositions.length >= 5) return; // Limit concurrent trades

      const symbols = marketDataRef.current.map(m => m.symbol);
      if (symbols.length === 0) return;

      // Pick a random symbol, but skip ones still on cooldown
      const available = symbols.filter(s => {
        const last = symbolCooldownRef.current.get(s) ?? 0;
        return Date.now() - last >= SYMBOL_COOLDOWN_MS;
      });

      const target = available[Math.floor(Math.random() * available.length)];
      if (target) await executeTrade(target);
    };

    const interval = setInterval(runAutomatedTrade, 30000); // Every 30s — safer for rate limits
    runAutomatedTrade(); // Fire once immediately on start
    return () => clearInterval(interval);
  }, [isBotRunning, executeTrade]);

  return {
    portfolio,
    marketData,
    isBotRunning,
    setIsBotRunning,
    logs,
    executeTrade,
    executeManualTrade,
    closePosition,
    riskSettings,
    setRiskSettings
  };
}
