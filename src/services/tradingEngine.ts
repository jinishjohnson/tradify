import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MarketData, Portfolio, Trade, AISignal, RiskSettings } from '../types/trading';
import { getTradingSignal } from './aiService';

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

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 50));
  }, []);

  // Simulate Market Ticking — track 5-min rolling change so AI sees real signal
  const priceHistory = useRef<Record<string, number[]>>({});

  useEffect(() => {
    const symbols = ['BTC', 'ETH', 'SOL', 'AAPL', 'TSLA', 'NVDA'];
    const HISTORY_WINDOW = 150; // 150 ticks × 2s = 5 minutes

    const interval = setInterval(() => {
      setMarketData(prev => {
        return symbols.map(s => {
          const old = prev.find(p => p.symbol === s);
          const basePrice = old?.price || (s === 'BTC' ? 65000 : s === 'ETH' ? 3500 : s === 'SOL' ? 150 : s === 'AAPL' ? 175 : s === 'TSLA' ? 250 : 900);
          const tick = (Math.random() - 0.48) * 0.012; // slightly bullish bias, ±1.2% per tick
          const newPrice = basePrice * (1 + tick);

          // Maintain rolling price history per symbol
          if (!priceHistory.current[s]) priceHistory.current[s] = [];
          priceHistory.current[s].push(newPrice);
          if (priceHistory.current[s].length > HISTORY_WINDOW) {
            priceHistory.current[s].shift();
          }

          // 5-min change: current vs oldest price in window
          const oldest = priceHistory.current[s][0] ?? newPrice;
          const rollingChange = ((newPrice / oldest) - 1) * 100;

          return {
            symbol: s,
            price: newPrice,
            change: rollingChange,      // 5-min % change — meaningful for AI
            volume: 100000 + Math.random() * 50000,
            timestamp: new Date().toISOString()
          };
        });
      });
    }, 2000);
    return () => clearInterval(interval);
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
    riskSettings,
    setRiskSettings
  };
}
