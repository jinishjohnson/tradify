import React, { useState, useEffect, useRef } from 'react';
import { MarketData, Portfolio, Trade, AISignal } from '../types/trading';
import { getTradingSignal } from './aiService';

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

  const addLog = (msg: string) => {
    setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 50));
  };

  // Simulate Market Ticking
  useEffect(() => {
    const symbols = ['BTC', 'ETH', 'SOL', 'AAPL', 'TSLA', 'NVDA'];
    const interval = setInterval(() => {
      setMarketData(prev => {
        return symbols.map(s => {
          const old = prev.find(p => p.symbol === s);
          const basePrice = old?.price || (s === 'BTC' ? 65000 : s === 'ETH' ? 3500 : 150);
          const change = (Math.random() - 0.5) * 0.005; // 0.5% max volatility per tick
          const newPrice = basePrice * (1 + change);
          return {
            symbol: s,
            price: newPrice,
            change: ((newPrice / (old?.price || newPrice)) - 1) * 100,
            volume: 100000 + Math.random() * 50000,
            timestamp: new Date().toISOString()
          };
        });
      });
    }, 2000);
    return () => clearInterval(interval);
  }, []);

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

  const executeTrade = async (symbol: string) => {
    const data = marketData.find(m => m.symbol === symbol);
    if (!data) return;

    addLog(`AI analyzing ${symbol}...`);
    const signal = await getTradingSignal(data);
    addLog(`AI Signal for ${symbol}: ${signal.action} (Confidence: ${(signal.confidence * 100).toFixed(0)}%)`);

    if (signal.action === 'HOLD') return;

    const quantity = (portfolio.balance * 0.1) / data.price; // Risk 10% of balance per trade
    if (quantity <= 0 || portfolio.balance < (data.price * quantity)) {
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
  };

  // Automated Trading Loop
  useEffect(() => {
    if (!isBotRunning) return;

    const runAutomatedTrade = async () => {
      if (portfolio.openPositions.length >= 5) return; // Limit concurrent trades

      // Pick a random symbol to analyze
      const symbols = marketData.map(m => m.symbol);
      const randomSymbol = symbols[Math.floor(Math.random() * symbols.length)];
      if (randomSymbol) {
        await executeTrade(randomSymbol);
      }
    };

    const interval = setInterval(runAutomatedTrade, 15000); // Analyze every 15s
    return () => clearInterval(interval);
  }, [isBotRunning, marketData, portfolio.balance, portfolio.openPositions.length]);

  return {
    portfolio,
    marketData,
    isBotRunning,
    setIsBotRunning,
    logs,
    executeTrade
  };
}
