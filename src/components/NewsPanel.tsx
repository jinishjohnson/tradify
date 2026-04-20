/**
 * NewsPanel.tsx — Live market news feed + AI stock suggestion
 * Data: Twelve Data News API (via server proxy)
 * AI:   Groq analyzes headlines → suggests a stock to BUY/SELL
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import Groq from 'groq-sdk';
import { RefreshCw, Zap, TrendingUp, TrendingDown, ExternalLink, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

// ── Groq client (same pattern as aiService.ts) ─────────────────────────────
const _groqKey = import.meta.env.VITE_GROQ_API_KEY as string | undefined;
const groqClient = _groqKey && _groqKey !== 'YOUR_GROQ_API_KEY_HERE'
  ? new Groq({ apiKey: _groqKey, dangerouslyAllowBrowser: true })
  : null;

interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  datetime: string;       // ISO or unix
  summary?: string;
  sentiment?: 'positive' | 'negative' | 'neutral';
  symbols?: string[];
}

interface AISuggestion {
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reason: string;
  category: 'stock' | 'crypto' | 'commodity';
}

interface NewsPanelProps {
  onTrade?: (symbol: string) => void;   // open order ticket for that symbol
}

function sentimentColor(s?: string) {
  if (s === 'positive') return 'news-pos';
  if (s === 'negative') return 'news-neg';
  return 'news-neu';
}

function relativeTime(dt: string | number): string {
  const d = typeof dt === 'number' ? new Date(dt * 1000) : new Date(dt);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}
// ── Fallback: pick best stock based on headline keywords ────────────────────
function ruleBasedSuggestion(headlines: string[]): AISuggestion {
  const text = headlines.join(' ').toLowerCase();
  const cryptoMentions = (text.match(/\b(bitcoin|btc|ethereum|eth|crypto|solana|sol)\b/g) ?? []).length;
  const positiveWords = (text.match(/\b(surge|rise|rally|beat|record|high|gain|growth|strong)\b/g) ?? []).length;
  const negativeWords = (text.match(/\b(fall|drop|slump|miss|recall|cut|loss|decline|weak)\b/g) ?? []).length;
  const nvda = text.includes('nvidia') || text.includes('nvda') || text.includes('ai chip');
  const aapl = text.includes('apple') || text.includes('aapl');
  const btc = text.includes('bitcoin') || text.includes('btc') || cryptoMentions > 1;
  const gold = text.includes('gold') || text.includes('xau');
  const tsla = text.includes('tesla') || text.includes('tsla');
  const action: 'BUY' | 'SELL' = positiveWords >= negativeWords ? 'BUY' : 'SELL';
  let symbol = 'NVDA', category: 'stock' | 'crypto' | 'commodity' = 'stock';
  if (btc) { symbol = 'BTC'; category = 'crypto'; }
  else if (gold) { symbol = 'XAUUSD'; category = 'commodity'; }
  else if (nvda) { symbol = 'NVDA'; }
  else if (aapl) { symbol = 'AAPL'; }
  else if (tsla) { symbol = 'TSLA'; }
  return { symbol, action, confidence: 0.62, reason: `Based on keyword analysis of current headlines — ${action === 'BUY' ? 'positive' : 'negative'} sentiment detected.`, category };
}

const SAMPLE_NEWS: NewsItem[] = [
  { id: '1', title: 'Federal Reserve Signals Potential Rate Cut in 2025 Amid Cooling Inflation', url: '#', source: 'Reuters', datetime: new Date(Date.now() - 900000).toISOString(), sentiment: 'positive', symbols: ['SPY', 'AAPL', 'NVDA'] },
  { id: '2', title: 'NVIDIA Beats Earnings Estimates as AI Chip Demand Surges to Record Levels', url: '#', source: 'Bloomberg', datetime: new Date(Date.now() - 1800000).toISOString(), sentiment: 'positive', symbols: ['NVDA'] },
  { id: '3', title: 'Bitcoin Surges Past $67,000 as Institutional Inflows Hit Monthly High', url: '#', source: 'CoinDesk', datetime: new Date(Date.now() - 2700000).toISOString(), sentiment: 'positive', symbols: ['BTC'] },
  { id: '4', title: 'Tesla Recalls 125,000 Vehicles Over Software Issue; Stock Slips 2%', url: '#', source: 'WSJ', datetime: new Date(Date.now() - 4200000).toISOString(), sentiment: 'negative', symbols: ['TSLA'] },
  { id: '5', title: 'Gold Surges to Record $4,800 as Dollar Weakens on Trade War Fears and Safe-Haven Demand', url: '#', source: 'MarketWatch', datetime: new Date(Date.now() - 5400000).toISOString(), sentiment: 'positive', symbols: ['XAUUSD'] },
  { id: '6', title: 'Apple Announces Record $110B Buyback Program; Shares Rise 3%', url: '#', source: 'CNBC', datetime: new Date(Date.now() - 7200000).toISOString(), sentiment: 'positive', symbols: ['AAPL'] },
  { id: '7', title: 'Oil Prices Drop 4% on Demand Concerns and Rising US Inventory Data', url: '#', source: 'Reuters', datetime: new Date(Date.now() - 9000000).toISOString(), sentiment: 'negative', symbols: ['USOIL'] },
  { id: '8', title: 'Microsoft Azure Revenue Grows 33% YoY; Cloud Division Outperforms Estimates', url: '#', source: 'Seeking Alpha', datetime: new Date(Date.now() - 10800000).toISOString(), sentiment: 'positive', symbols: ['MSFT'] },
];

export function NewsPanel({ onTrade }: NewsPanelProps) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<AISuggestion | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [usingFallback, setUsingFallback] = useState(false);
  const suggestionRef = useRef<AISuggestion | null>(null);

  // ── Fetch news ──────────────────────────────────────────────────────────
  const fetchNews = useCallback(async () => {
    setLoading(true);
    try {
      // Try server proxy first (production), then fall back to direct Twelve Data call
      let items: NewsItem[] = [];

      const proxyRes = await fetch('/api/proxy/news').catch(() => null);
      if (proxyRes?.ok) {
        const data = await proxyRes.json();
        items = (data?.data ?? []).map((item: any, i: number) => ({
          id: String(i),
          title: item.title ?? item.headline ?? '',
          url: item.url ?? item.link ?? '#',
          source: item.source ?? item.publisher ?? 'Unknown',
          datetime: item.published_at ?? item.datetime ?? new Date().toISOString(),
          summary: item.summary ?? item.description ?? '',
          sentiment: item.sentiment ?? undefined,
          symbols: item.symbols ?? [],
        })).filter((n: NewsItem) => n.title);
      }

      // Direct Finnhub call for real market news (dev mode — VITE key)
      if (items.length === 0) {
        const finnhubKey = import.meta.env.VITE_FINNHUB_KEY as string | undefined;
        if (finnhubKey && finnhubKey !== 'YOUR_FINNHUB_API_KEY_HERE') {
          const res = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${finnhubKey}`).catch(() => null);
          if (res?.ok) {
            const data = await res.json();
            items = (data ?? []).slice(0, 15).map((item: any, i: number) => ({
              id: String(item.id || i),
              title: item.headline ?? '',
              url: item.url ?? '#',
              source: item.source ?? 'Unknown',
              datetime: item.datetime ? new Date(item.datetime * 1000).toISOString() : new Date().toISOString(),
              summary: item.summary ?? '',
              sentiment: undefined,
              symbols: item.related ? item.related.split(',') : [],
            })).filter((n: NewsItem) => n.title);
          }
        }
      }

      if (items.length > 0) {
        setNews(items);
        setUsingFallback(false);
      } else {
        setNews(SAMPLE_NEWS);
        setUsingFallback(true);
      }
      setLastUpdated(new Date());
    } catch {
      setNews(SAMPLE_NEWS);
      setUsingFallback(true);
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  // ── AI suggestion ────────────────────────────────────────────────────────
  const fetchSuggestion = useCallback(async (headlines: string[]) => {
    if (headlines.length === 0 || aiLoading) return;
    setAiLoading(true);
    try {
      let suggestion: AISuggestion | null = null;

      // Try server proxy first (production)
      const proxyRes = await fetch('/api/proxy/news-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headlines }),
      }).catch(() => null);

      if (proxyRes?.ok) {
        const data = await proxyRes.json();
        if (data.symbol && data.action) suggestion = data;
      }

      // Groq SDK (dev mode — same as aiService.ts)
      if (!suggestion && groqClient) {
        try {
          const completion = await groqClient.chat.completions.create({
            model: 'llama3-8b-8192',
            messages: [
              {
                role: 'system',
                content: 'You are a financial analyst. Based on news headlines, suggest ONE stock or crypto to trade right now. Respond with ONLY valid JSON using these exact keys: symbol (ticker string), action ("BUY" or "SELL"), confidence (number 0-1), reason (string), category ("stock" or "crypto" or "commodity")',
              },
              {
                role: 'user',
                content: `Which asset should I trade based on these headlines?\n\n${headlines.slice(0, 8).map((h, i) => `${i + 1}. ${h}`).join('\n')}`,
              },
            ],
            max_tokens: 250,
            temperature: 0.3,
            response_format: { type: 'json_object' },
          });
          const raw = completion.choices[0]?.message?.content ?? '{}';
          const parsed = JSON.parse(raw);
          if (parsed.symbol && parsed.action) suggestion = parsed;
        } catch { /* fall through to rule-based */ }
      }

      // Rule-based fallback (always works, no API needed)
      if (!suggestion) suggestion = ruleBasedSuggestion(headlines);

      if (suggestion) {
        setSuggestion(suggestion);
        suggestionRef.current = suggestion;
      }
    } catch { /* keep previous suggestion */ }
    finally { setAiLoading(false); }
  }, [aiLoading]);

  // Initial load + auto-refresh every 5 min
  useEffect(() => {
    fetchNews();
    const id = setInterval(fetchNews, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [fetchNews]);

  // Trigger AI analysis when news loads
  useEffect(() => {
    if (news.length > 0 && !suggestionRef.current) {
      fetchSuggestion(news.map(n => n.title));
    }
  }, [news, fetchSuggestion]);

  const confidencePct = suggestion ? Math.round(suggestion.confidence * 100) : 0;

  return (
    <div className="news-root">

      {/* ── AI Suggestion Banner ─────────────────────────────────────── */}
      <div className={cn('news-suggest-bar', suggestion?.action === 'BUY' ? 'buy' : suggestion?.action === 'SELL' ? 'sell' : '')}>
        <div className="news-suggest-icon">
          <Zap size={13} />
        </div>
        <div className="news-suggest-body">
          {aiLoading && !suggestion ? (
            <span className="news-suggest-loading"><Loader2 size={11} className="spin" /> AI analyzing headlines…</span>
          ) : suggestion ? (
            <>
              <span className="news-suggest-label">AI Suggests</span>
              <span className={cn('news-suggest-action', suggestion.action === 'BUY' ? 'buy' : 'sell')}>
                {suggestion.action === 'BUY' ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                {suggestion.action} {suggestion.symbol}
              </span>
              <span className="news-suggest-conf">{confidencePct}% confidence</span>
              <span className="news-suggest-reason">{suggestion.reason}</span>
            </>
          ) : (
            <span className="news-suggest-loading">Waiting for news…</span>
          )}
        </div>
        {suggestion && onTrade && (
          <button
            className={cn('news-suggest-trade-btn', suggestion.action === 'BUY' ? 'buy' : 'sell')}
            onClick={() => onTrade(suggestion.symbol)}
          >
            Trade {suggestion.symbol}
          </button>
        )}
        {aiLoading && suggestion && <Loader2 size={10} className="spin news-ai-refresh" />}
      </div>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="news-header">
        <span className="news-header-title">
          Market News
          {usingFallback && <span className="news-fallback-badge">sample</span>}
        </span>
        {lastUpdated && (
          <span className="news-updated">Updated {relativeTime(lastUpdated.toISOString())}</span>
        )}
        <button
          className={cn('news-refresh-btn', loading && 'loading')}
          onClick={() => { fetchNews(); fetchSuggestion(news.map(n => n.title)); }}
          disabled={loading}
          title="Refresh news"
        >
          <RefreshCw size={11} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {/* ── News list ────────────────────────────────────────────────── */}
      <div className="news-list">
        {loading && news.length === 0 ? (
          <div className="news-empty"><Loader2 size={20} className="spin" /> Loading news…</div>
        ) : news.map(item => (
          <div key={item.id} className="news-item">
            <div className="news-item-top">
              <span className={cn('news-sentiment-dot', sentimentColor(item.sentiment))} />
              <a
                href={item.url !== '#' ? item.url : undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="news-title"
                onClick={item.url === '#' ? e => e.preventDefault() : undefined}
              >
                {item.title}
                {item.url !== '#' && <ExternalLink size={9} className="news-ext-icon" />}
              </a>
            </div>
            <div className="news-item-meta">
              <span className="news-source">{item.source}</span>
              <span className="news-dot">·</span>
              <span className="news-time">{relativeTime(item.datetime)}</span>
              {item.symbols && item.symbols.length > 0 && (
                <>
                  <span className="news-dot">·</span>
                  {item.symbols.slice(0, 3).map(s => (
                    <span
                      key={s}
                      className="news-sym-tag"
                      onClick={() => onTrade && onTrade(s)}
                      title={`Open order ticket for ${s}`}
                    >
                      {s}
                    </span>
                  ))}
                </>
              )}
            </div>
            {item.summary && (
              <div className="news-summary">{item.summary.slice(0, 140)}{item.summary.length > 140 ? '…' : ''}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
