/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import Logo from './assets/logo.png';

import {
  TrendingUp,
  TrendingDown,
  Activity,
  Wallet,
  Shield,
  Target,
  Layers,
  Zap,
  Pause,
  Play,
  Terminal,
  History,
  Settings,
  ArrowRight,
  Smartphone,
  Globe,
  Calendar,
  AlertTriangle
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import { useTradingEngine } from './services/tradingEngine';
import { cn, formatCurrency, formatPercentage } from './lib/utils';
import { getMarketRecommendations } from './services/aiService';
import { AISignal, NewsItem, EventItem } from './types/trading';
import { fetchLiveNews, fetchUpcomingEvents, fetchPythonMarketStats, PythonMarketStats } from './services/dataService';
import { useEffect } from 'react';

export default function App() {
  const {
    portfolio,
    marketData,
    isBotRunning,
    setIsBotRunning,
    logs,
    executeTrade,
    riskSettings,
    setRiskSettings
  } = useTradingEngine();

  const totalPnL = useMemo(() => {
    const closedPnL = portfolio.history.reduce((acc, trade) => acc + (trade.profit || 0), 0);
    const openPnL = portfolio.openPositions.reduce((acc, pos) => {
      const current = marketData.find(m => m.symbol === pos.symbol);
      if (!current) return acc;
      return acc + (current.price - pos.price) * pos.quantity * (pos.side === 'BUY' ? 1 : -1);
    }, 0);
    return closedPnL + openPnL;
  }, [portfolio.history, portfolio.openPositions, marketData]);

  const pnlPercent = (totalPnL / 10000) * 100;

  const [recommendations, setRecommendations] = useState<AISignal[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [appSyncStatus, setAppSyncStatus] = useState<'syncing' | 'connected'>('connected');
  const [pythonStats, setPythonStats] = useState<PythonMarketStats | null>(null);
  const [currentTab, setCurrentTab] = useState('overview');
  const [selectedSymbol, setSelectedSymbol] = useState<string>('NIFTY50');
  const [riskModalOpen, setRiskModalOpen] = useState(false);

  useEffect(() => {
    fetchLiveNews().then(setNews);
    fetchUpcomingEvents().then(setEvents);
    fetchPythonMarketStats().then(setPythonStats);
    const dataInterval = setInterval(() => {
      fetchLiveNews().then(setNews);
      fetchUpcomingEvents().then(setEvents);
      fetchPythonMarketStats().then(setPythonStats);
    }, 60000);

    return () => clearInterval(dataInterval);
  }, []);

  useEffect(() => {
    if (marketData.length === 0) return;

    const fetchRecs = async () => {
      const recs = await getMarketRecommendations(marketData);
      setRecommendations(recs);
    };

    fetchRecs();
    const interval = setInterval(fetchRecs, 30000);
    return () => clearInterval(interval);
  }, [marketData.length > 0]);

  return (
    <div className="min-h-screen flex flex-col font-sans selection:bg-brand-gold selection:text-black">
      {/* Sophisticated Header */}
      <header className="h-20 border-b border-brand-border bg-brand-bg px-10 flex items-center justify-between sticky top-0 z-50">
        <div className="logo-text"><img src={Logo} alt="Logo" className='h-12 w-[150px] sm:w-auto' /></div>

        <div className="flex items-center gap-6">
          <div className="status-pill">
            <div className={cn("status-dot", !isBotRunning && "bg-brand-dim animate-none")} />
            {isBotRunning ? "AI Engine Active" : "AI Engine Standby"}
          </div>
          <div className="status-pill border-brand-dim text-brand-dim hidden sm:flex">
            Latency: 12ms
          </div>

          <button
            onClick={() => setIsBotRunning(!isBotRunning)}
            className={cn(
              "px-6 py-2 rounded font-bold text-[11px] uppercase tracking-widest transition-all",
              isBotRunning
                ? "bg-brand-dim/20 text-brand-dim hover:bg-brand-dim/30"
                : "bg-brand-gold text-black hover:bg-brand-gold/90"
            )}
          >
            {isBotRunning ? "Pause AI" : "Deploy Capital"}
          </button>
        </div>
      </header>

      <main className="flex-grow p-6 grid grid-cols-1 lg:grid-cols-[320px_1fr_300px] gap-6 max-w-[1800px] mx-auto w-full">
        {/* Left Column - Performance & Markets */}
        <aside className="panel">
          <div className="section-label">Performance Metrics</div>
          <div className="mb-8 space-y-4">
            <div>
              <div className="text-[10px] text-brand-dim uppercase tracking-wider mb-1">Account Equity</div>
              <div className="stat-value">{formatCurrency(portfolio.balance + totalPnL)}</div>
              <div className="stat-sub">Growth: {totalPnL >= 0 ? '+' : ''}{formatPercentage(pnlPercent)}</div>
            </div>

            <div className="grid grid-cols-2 gap-4 border-t border-brand-border pt-4">
              <div>
                <div className="text-[10px] text-brand-dim uppercase tracking-wider mb-1">Opening Bal</div>
                <div className="font-mono text-sm text-brand-ink">{formatCurrency(10000)}</div>
              </div>
              <div>
                <div className="text-[10px] text-brand-dim uppercase tracking-wider mb-1">Profit Gained</div>
                <div className={cn(
                  "font-mono text-sm font-bold",
                  totalPnL >= 0 ? "text-brand-accent" : "text-brand-danger"
                )}>
                  {totalPnL >= 0 ? '+' : ''}{formatCurrency(totalPnL)}
                </div>
              </div>
            </div>
          </div>

          <div className="section-label">Active Markets</div>
          <div className="flex-grow overflow-y-auto space-y-1 pr-1 custom-scrollbar">
            {marketData.map((ticker) => (
              <div
                key={ticker.symbol}
                className="group p-4 bg-white/5 border border-transparent hover:border-brand-gold/30 rounded transition-all cursor-pointer flex items-center justify-between"
                onClick={() => executeTrade(ticker.symbol)}
              >
                <div>
                  <div className="text-sm font-bold text-brand-ink">{ticker.symbol}</div>
                  <div className="text-[10px] text-brand-dim uppercase tracking-wider">Vol: {ticker.volume.toLocaleString()}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-mono font-bold text-brand-ink">{formatCurrency(ticker.price)}</div>
                  <div className={cn(
                    "text-[10px] font-bold",
                    ticker.change >= 0 ? "text-brand-accent" : "text-brand-danger"
                  )}>
                    {ticker.change >= 0 ? '+' : ''}{ticker.change.toFixed(2)}%
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="section-label mt-8">System Logs</div>
          <div className="h-48 overflow-y-auto pr-1 flex flex-col-reverse custom-scrollbar">
            {logs.map((log, i) => (
              <div key={i} className="log-item">
                <span className="opacity-50">{log.split(']')[0]}]</span>
                {log.split(']')[1]}
              </div>
            ))}
          </div>
        </aside>

        {/* Center Column - Chart & History */}
        <section className="panel items-center justify-center relative">
          <div className="absolute top-6 left-6 section-label">Live Portfolio Trajectory</div>

          <div className="flex flex-col items-center">
            <div className="font-serif text-[64px] text-white leading-tight mb-8">
              {formatCurrency(portfolio.balance + totalPnL)}
            </div>

            <div className="w-full" style={{ height: '300px', minHeight: '300px', position: 'relative' }}>
              <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="gradGold" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#c5a059" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#080808" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="value" stroke="#c5a059" strokeWidth={2} fill="url(#gradGold)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="w-full mt-12 grid grid-cols-3 gap-8">
            <div className="text-center">
              <div className="section-label">Volatility (Ann.)</div>
              <div className="font-serif text-2xl">{pythonStats ? (pythonStats.annualized_volatility * 100).toFixed(2) + '%' : '...'}</div>
            </div>
            <div className="text-center">
              <div className="section-label">7D SMA (BTC)</div>
              <div className="font-serif text-2xl">{pythonStats ? formatCurrency(pythonStats.sma_7) : '...'}</div>
            </div>
            <div className="text-center">
              <div className="section-label">Max Drawdown</div>
              <div className="font-serif text-2xl">{pythonStats ? (pythonStats.max_drawdown_30d * 100).toFixed(2) + '%' : '...'}</div>
            </div>
          </div>

          <div className="w-full mt-12 grid grid-cols-1 xl:grid-cols-2 gap-6 overflow-hidden">
            <div>
              <div className="section-label flex items-center gap-2"><Globe className="w-3 h-3" /> Market Intelligence</div>
              <div className="space-y-2">
                {news.map((item) => (
                  <div key={item.id} className="p-3 border border-brand-border rounded hover:bg-white/5 transition-colors flex items-start gap-3">
                    <div className={cn("w-1.5 h-1.5 rounded-full mt-1.5 shrink-0", item.sentiment === 'positive' ? 'bg-brand-accent' : item.sentiment === 'negative' ? 'bg-brand-danger' : 'bg-brand-gold')} />
                    <div className="w-full h-full overflow-hidden">
                      <div className="text-[10px] text-brand-dim uppercase tracking-wider mb-1 flex justify-between">
                        <span>{item.source}</span>
                        <span>{item.time}</span>
                      </div>
                      <div className="text-[11px] font-medium leading-snug text-brand-ink">{item.headline}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="section-label flex items-center gap-2"><History className="w-3 h-3" /> Recent Settlements</div>
              <div className="space-y-2 mb-8">
                {portfolio.history.slice(0, 3).map((trade) => (
                  <div key={trade.id} className="flex items-center justify-between p-3 border border-brand-border rounded hover:bg-white/5 transition-colors">
                    <div className="flex items-center gap-3">
                      <History className="w-3 h-3 text-brand-gold opacity-50" />
                      <span className="text-[11px] font-bold">{trade.symbol}</span>
                      <span className="text-[9px] text-brand-dim font-mono">{new Date(trade.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className={cn(
                      "text-[11px] font-mono font-bold",
                      (trade.profit || 0) >= 0 ? "text-brand-accent" : "text-brand-danger"
                    )}>
                      {(trade.profit || 0) >= 0 ? '+' : ''}{formatCurrency(trade.profit || 0)}
                    </div>
                  </div>
                ))}
              </div>

              <div className="section-label flex items-center gap-2"><Calendar className="w-3 h-3" /> Macro Events</div>
              <div className="space-y-2">
                {events.map((item) => (
                  <div key={item.id} className="p-3 border border-brand-border rounded hover:bg-white/5 transition-colors flex items-center justify-between">
                    <div>
                      <div className="text-[11px] font-bold text-brand-ink mb-0.5">{item.title}</div>
                      <div className="text-[9px] text-brand-dim uppercase tracking-wider">{item.country} • {item.time}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-mono text-brand-gold">{item.forecast || '-'}</div>
                      <div className="text-[8px] text-brand-dim uppercase">Forecast</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Right Column - Risk & Exposure */}
        <aside className="panel">
          <div className="section-label">Smart Assist AI</div>
          <div className="space-y-4 mb-10">
            {recommendations.map((rec, i) => (
              <div key={i} className="p-4 bg-brand-gold/5 border border-brand-gold/20 rounded-lg relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-2 opacity-20">
                  <TrendingUp className="w-8 h-8 text-brand-gold" />
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-bold text-brand-gold">{rec.symbol}</span>
                  <span className="px-1.5 py-0.5 bg-brand-gold text-black text-[8px] font-bold rounded uppercase tracking-tighter">Massive Gain Potential</span>
                </div>
                <p className="text-[10px] text-brand-dim leading-relaxed mb-3 pr-6">
                  {rec.reasoning}
                </p>
                <div className="flex justify-between items-center bg-black/40 p-2 rounded border border-white/5">
                  <div>
                    <div className="text-[8px] text-brand-dim uppercase">Target Price</div>
                    <div className="text-xs font-mono font-bold text-brand-accent">{formatCurrency(rec.targetPrice || 0)}</div>
                  </div>
                  <button
                    onClick={() => executeTrade(rec.symbol)}
                    className="flex items-center gap-1 px-3 py-1 bg-brand-gold text-black text-[9px] font-bold rounded hover:bg-brand-gold/80 transition-all uppercase tracking-tighter"
                  >
                    Auto-Buy <ArrowRight className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>
            ))}
            {recommendations.length === 0 && (
              <div className="text-center py-4 border border-dashed border-brand-border rounded-lg text-[10px] text-brand-dim animate-pulse">
                AI Scanning for massive gems...
              </div>
            )}
          </div>

          <div className="section-label flex items-center gap-2 mt-8"><Shield className="w-3 h-3" /> Auto Risk Management</div>
          <div className="space-y-3">
            <div className="p-3 bg-white/5 border border-brand-border rounded flex items-center justify-between">
              <div>
                <div className="text-[11px] font-bold">Auto-Hedge Exposure</div>
                <div className="text-[9px] text-brand-dim mt-0.5">Dynamically open inverse positions</div>
              </div>
              <button
                onClick={() => setRiskSettings(s => ({ ...s, autoHedge: !s.autoHedge }))}
                className={cn("w-8 h-4 rounded-full relative transition-colors", riskSettings.autoHedge ? "bg-brand-accent/20" : "bg-brand-dim/20")}
              >
                <div className={cn("absolute top-0.5 w-3 h-3 rounded-full transition-all", riskSettings.autoHedge ? "right-0.5 bg-brand-accent" : "left-0.5 bg-brand-dim")} />
              </button>
            </div>

            <div className="p-3 bg-white/5 border border-brand-border rounded flex items-center justify-between">
              <div>
                <div className="text-[11px] font-bold">Global Trailing Stop</div>
                <div className="text-[9px] text-brand-dim mt-0.5">Secure unrealized PnL</div>
              </div>
              <button
                onClick={() => setRiskSettings(s => ({ ...s, trailingStop: !s.trailingStop }))}
                className={cn("w-8 h-4 rounded-full relative transition-colors", riskSettings.trailingStop ? "bg-brand-accent/20" : "bg-brand-dim/20")}
              >
                <div className={cn("absolute top-0.5 w-3 h-3 rounded-full transition-all", riskSettings.trailingStop ? "right-0.5 bg-brand-accent" : "left-0.5 bg-brand-dim")} />
              </button>
            </div>

            <div className="pt-3 border-t border-brand-border/50">
              <div className="flex justify-between text-[10px] mb-2 font-medium">
                <span>Daily Loss Limit</span>
                <span className="text-brand-danger">{riskSettings.dailyLossLimit}%</span>
              </div>
              <input
                type="range"
                min="1"
                max="20"
                value={riskSettings.dailyLossLimit}
                onChange={(e) => setRiskSettings(s => ({ ...s, dailyLossLimit: parseInt(e.target.value) }))}
                className="w-full accent-brand-danger h-1 bg-white/10 rounded-full appearance-none cursor-pointer"
              />
            </div>
          </div>

          <div className="section-label mt-12">Current Exposure</div>
          <div className="flex flex-wrap gap-2">
            {['BTC 42%', 'ETH 28%', 'SOL 12%', 'USDT 18%'].map(asset => (
              <span key={asset} className="px-2 py-1 bg-white/5 rounded text-[10px] text-brand-dim uppercase tracking-wider border border-white/5">
                {asset}
              </span>
            ))}
          </div>

          <div className="section-label mt-12">Active Positions</div>
          <div className="space-y-3 flex-grow overflow-y-auto custom-scrollbar pr-1">
            <AnimatePresence>
              {portfolio.openPositions.map((pos) => {
                const current = marketData.find(m => m.symbol === pos.symbol);
                const pnl = current ? (current.price - pos.price) * pos.quantity * (pos.side === 'BUY' ? 1 : -1) : 0;
                return (
                  <motion.div
                    key={pos.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="p-3 bg-white/5 border border-brand-border rounded flex justify-between items-center group cursor-default"
                  >
                    <div>
                      <div className="text-[10px] font-bold text-brand-gold group-hover:text-brand-accent transition-colors">{pos.symbol}</div>
                      <div className="text-[9px] text-brand-dim font-mono uppercase">{pos.side} • {pos.quantity.toFixed(4)}</div>
                    </div>
                    <div className={cn(
                      "text-[10px] font-mono font-bold",
                      pnl >= 0 ? "text-brand-accent" : "text-brand-danger"
                    )}>
                      {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            {portfolio.openPositions.length === 0 && (
              <div className="text-center py-8 text-[11px] text-brand-dim italic opacity-50">
                No active exposure
              </div>
            )}
          </div>

          <div className="section-label flex items-center gap-2 mt-8"><Smartphone className="w-3 h-3" /> App Monitor</div>
          <div className="p-4 border border-brand-border bg-brand-card rounded-lg relative overflow-hidden group">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Smartphone className="w-5 h-5 text-brand-ink" />
                  <div className="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-brand-bg rounded-full flex items-center justify-center">
                    <div className={cn("w-1.5 h-1.5 rounded-full animate-pulse", appSyncStatus === 'connected' ? "bg-brand-accent" : "bg-brand-gold")} />
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-bold">Tradify Mobile</div>
                  <div className="text-[9px] text-brand-dim">iOS • iPhone 15 Pro Max</div>
                </div>
              </div>
              <button onClick={() => setAppSyncStatus(s => s === 'connected' ? 'syncing' : 'connected')} className="text-[9px] px-2 py-1 bg-white/5 hover:bg-white/10 rounded uppercase tracking-wider text-brand-dim transition-colors">
                Ping
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-brand-border">
              <div>
                <div className="text-[8px] uppercase tracking-wider text-brand-dim mb-1">Status</div>
                <div className="text-[10px] font-mono text-brand-ink">{appSyncStatus === 'connected' ? 'Connected' : 'Syncing...'}</div>
              </div>
              <div>
                <div className="text-[8px] uppercase tracking-wider text-brand-dim mb-1">Last Sync</div>
                <div className="text-[10px] font-mono text-brand-ink">Just now</div>
              </div>
            </div>
          </div>
        </aside>
      </main>

      {/* Sophisticated Footer */}
      <footer className="h-10 bg-brand-bg border-t border-brand-border px-10 flex items-center justify-between text-[9px] tracking-[2px] text-brand-dim uppercase">
        <div className="flex gap-6">
          <span>Aether Quantum v4.0</span>
          <span className="flex items-center gap-1.5 line-clamp-1">
            <div className="w-1 h-1 bg-brand-accent rounded-full animate-pulse" />
            Oracle Synchronized
          </span>
        </div>
        <div className="flex gap-6">
          <span>Asset Class: Crypto/Digital Portfolio</span>
          <span>Security Protocol: AES-256</span>
        </div>
      </footer>
    </div>
  );
}

function RiskControl({ label, value, progress, accentColor = "brand-gold" }: { label: string, value: string, progress: number, accentColor?: string }) {
  return (
    <div>
      <div className="flex justify-between text-[11px] mb-2 font-medium">
        <span>{label}</span>
        <span className={cn(accentColor === "brand-accent" ? "text-brand-accent" : "text-brand-gold")}>{value}</span>
      </div>
      <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
        <div
          className={cn("h-full transition-all duration-1000", `bg-${accentColor}`)}
          style={{ width: `${progress}%`, backgroundColor: accentColor === "brand-gold" ? "#c5a059" : "#00ff88" }}
        />
      </div>
    </div>
  );
}


const chartData = [
  { value: 10000 }, { value: 10120 }, { value: 10080 }, { value: 10250 },
  { value: 10400 }, { value: 10350 }, { value: 10600 }, { value: 10800 },
  { value: 10750 }, { value: 10900 }, { value: 11200 }, { value: 11150 },
  { value: 11400 }, { value: 11800 }, { value: 11700 }, { value: 12100 },
];
