import Groq from "groq-sdk";
import { MarketData, AISignal } from "../types/trading";

// ── Groq client (primary engine) ─────────────────────────────────────────────
const groqKey = import.meta.env.VITE_GROQ_API_KEY;
const groq = groqKey && groqKey !== "YOUR_GROQ_API_KEY_HERE"
  ? new Groq({ apiKey: groqKey, dangerouslyAllowBrowser: true })
  : null;

// Model to use — Llama 3.3 70B is Groq's most capable free model
const GROQ_MODEL = "llama-3.3-70b-versatile";

// ── Rate limiter (Groq free tier: 30 req/min) ─────────────────────────────────
const REQUEST_LOG: number[] = [];
const MAX_REQ_PER_MIN = 25; // stay under 30

function canRequest(): boolean {
  const now = Date.now();
  while (REQUEST_LOG.length && REQUEST_LOG[0] < now - 60_000) REQUEST_LOG.shift();
  return REQUEST_LOG.length < MAX_REQ_PER_MIN;
}
function recordRequest() { REQUEST_LOG.push(Date.now()); }

// ── Response cache (2 minutes) ────────────────────────────────────────────────
const SIGNAL_CACHE = new Map<string, { ts: number; value: AISignal }>();
let recCache: { ts: number; value: AISignal[] } | null = null;
const CACHE_TTL = 120_000;

// ── Rule-based fallback (zero API calls) ─────────────────────────────────────
function ruleBasedSignal(md: MarketData): AISignal {
  const { symbol, price, change, volume } = md;
  const volBoost = volume > 130_000 ? 1.15 : 1.0;
  let action: "BUY" | "SELL" | "HOLD" = "HOLD";
  let confidence = 0;
  let reasoning = `Low momentum (${change.toFixed(2)}%) — holding`;

  if (change > 0.15 * volBoost) {
    action = "BUY";
    confidence = Math.min(0.5 + Math.abs(change) * 2, 0.85);
    reasoning = `Momentum BUY: +${change.toFixed(2)}% with ${volume > 130_000 ? "high" : "normal"} volume`;
  } else if (change < -0.15 * volBoost) {
    action = "SELL";
    confidence = Math.min(0.5 + Math.abs(change) * 2, 0.85);
    reasoning = `Momentum SELL: ${change.toFixed(2)}% with ${volume > 130_000 ? "high" : "normal"} volume`;
  }

  return {
    symbol,
    action,
    confidence,
    reasoning: `[Rule-based] ${reasoning}`,
    suggestedStopLoss: price * (action === "SELL" ? 1.015 : 0.985),
    suggestedTakeProfit: price * (action === "SELL" ? 0.96 : 1.04),
  };
}

// ── Core Groq call with JSON parsing ─────────────────────────────────────────
async function callGroq<T>(systemPrompt: string, userPrompt: string): Promise<T> {
  if (!groq) throw new Error("GROQ_KEY_MISSING");
  if (!canRequest()) throw new Error("RATE_LIMITED");

  recordRequest();
  const completion = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 512,
    response_format: { type: "json_object" },
  });

  const text = completion.choices[0]?.message?.content ?? "{}";
  return JSON.parse(text) as T;
}

// ── getTradingSignal ──────────────────────────────────────────────────────────
export async function getTradingSignal(marketData: MarketData): Promise<AISignal> {
  const cacheKey = `${marketData.symbol}:${Math.round(marketData.price / 10)}`;
  const cached = SIGNAL_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.value;

  try {
    const raw = await callGroq<{
      action: string;
      confidence: number;
      reasoning: string;
      suggestedStopLoss: number;
      suggestedTakeProfit: number;
    }>(
      `You are an aggressive algorithmic trading advisor optimizing for profit.
       Prefer BUY or SELL signals — only use HOLD if the market is completely flat.
       Respond ONLY with a valid JSON object with these exact keys:
       action (BUY|SELL|HOLD), confidence (0.5-0.95), reasoning (string, max 80 chars),
       suggestedStopLoss (number), suggestedTakeProfit (number).`,
      `Analyze ${marketData.symbol}:
       Current Price: $${marketData.price.toFixed(2)}
       5-Minute Change: ${marketData.change.toFixed(3)}%
       Volume: ${marketData.volume.toFixed(0)}
       
       If change > 0.3% → lean BUY. If change < -0.3% → lean SELL.
       Set stop-loss 1.5% from price and take-profit 4% from price.`
    );

    const signal: AISignal = {
      symbol: marketData.symbol,
      action: (["BUY", "SELL", "HOLD"].includes(raw.action) ? raw.action : "HOLD") as "BUY" | "SELL" | "HOLD",
      confidence: raw.confidence ?? 0,
      reasoning: raw.reasoning ?? "",
      suggestedStopLoss: raw.suggestedStopLoss ?? marketData.price * 0.985,
      suggestedTakeProfit: raw.suggestedTakeProfit ?? marketData.price * 1.04,
    };

    SIGNAL_CACHE.set(cacheKey, { ts: Date.now(), value: signal });
    return signal;
  } catch (err: any) {
    const reason = err?.message ?? "";
    if (reason !== "GROQ_KEY_MISSING" && reason !== "RATE_LIMITED") {
      console.error("[Groq] Signal error:", err);
    } else {
      console.warn(`[Groq] ${reason} — using rule-based signal for ${marketData.symbol}`);
    }
    const fallback = ruleBasedSignal(marketData);
    SIGNAL_CACHE.set(cacheKey, { ts: Date.now(), value: fallback });
    return fallback;
  }
}

// ── getMarketRecommendations ─────────────────────────────────────────────────
export async function getMarketRecommendations(marketData: MarketData[]): Promise<AISignal[]> {
  if (recCache && Date.now() - recCache.ts < CACHE_TTL) return recCache.value;

  try {
    const raw = await callGroq<{ recommendations: Array<{
      symbol: string;
      action: string;
      confidence: number;
      reasoning: string;
      targetPrice: number;
    }>}>(
      `You are a high-frequency trading analyst.
       Respond ONLY with valid JSON: { "recommendations": [ ...array of 2 items... ] }
       Each item: symbol, action (must be "BUY"), confidence (0-1), reasoning (max 60 chars), targetPrice.`,
      `Market data: ${JSON.stringify(marketData.map(d => ({
        symbol: d.symbol, price: d.price, change: d.change
      })))}
       Pick the Top 2 BUY opportunities for gains in the next few hours.`
    );

    const result = (raw.recommendations ?? []).map(r => ({
      symbol: r.symbol,
      action: "BUY" as const,
      confidence: r.confidence ?? 0.5,
      reasoning: r.reasoning ?? "",
      suggestedStopLoss: 0,
      suggestedTakeProfit: r.targetPrice ?? 0,
    }));

    recCache = { ts: Date.now(), value: result };
    return result;
  } catch (err: any) {
    const reason = err?.message ?? "";
    if (reason !== "GROQ_KEY_MISSING" && reason !== "RATE_LIMITED") {
      console.error("[Groq] Recommendations error:", err);
    }
    // Fallback: top 2 gainers by momentum
    const top2 = [...marketData]
      .sort((a, b) => b.change - a.change)
      .slice(0, 2)
      .map(ruleBasedSignal)
      .filter(s => s.action === "BUY");
    recCache = { ts: Date.now(), value: top2 };
    return top2;
  }
}
