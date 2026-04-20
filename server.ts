import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const basePort = Number(process.env.PORT ?? 3000);
  const host = "0.0.0.0";

  app.use(express.json());

  // ── Health ────────────────────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // ── Twelve Data Proxy (keys stay server-side) ─────────────────────────────
  // GET /api/proxy/quotes?symbols=AAPL,TSLA,NVDA,...
  app.get("/api/proxy/quotes", async (req, res) => {
    const key = process.env.TWELVE_DATA_API_KEY;
    if (!key) return res.status(503).json({ error: "TWELVE_DATA_API_KEY not set" });
    const symbols = req.query.symbols as string;
    if (!symbols) return res.status(400).json({ error: "symbols required" });
    try {
      const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols)}&apikey=${key}`;
      const upstream = await fetch(url);
      const data = await upstream.json();
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: "Twelve Data unavailable" });
    }
  });

  // GET /api/proxy/stocks-quote?symbols=AAPL,TSLA,NVDA
  app.get("/api/proxy/stocks-quote", async (req, res) => {
    const key = process.env.FINNHUB_KEY || process.env.VITE_FINNHUB_KEY;
    if (!key) return res.status(503).json({ error: "FINNHUB key not set" });
    const symbols = String(req.query.symbols || "");
    if (!symbols) return res.status(400).json({ error: "symbols required" });
    const list = symbols.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 60);

    try {
      const rows = await Promise.all(
        list.map(async (sym) => {
          const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${key}`;
          const r = await fetch(url);
          const j = await r.json();
          return {
            symbol: sym,
            price: Number(j?.c || 0),
            change: Number(j?.dp || 0),
            volume: 0,
          };
        }),
      );
      res.json({ data: rows.filter((r) => Number.isFinite(r.price) && r.price > 0) });
    } catch (_err) {
      res.status(502).json({ error: "Finnhub quote unavailable" });
    }
  });

  // GET /api/proxy/commodities-quote?symbols=GC=F,SI=F,CL=F
  app.get("/api/proxy/commodities-quote", async (req, res) => {
    const symbols = String(req.query.symbols || "");
    if (!symbols) return res.status(400).json({ error: "symbols required" });
    const list = symbols.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 30);
    const query = encodeURIComponent(list.join(","));

    try {
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${query}`;
      const r = await fetch(url);
      const j = await r.json();
      const rows = (j?.quoteResponse?.result || []).map((row: any) => ({
        symbol: String(row?.symbol || ""),
        price: Number(row?.regularMarketPrice || 0),
        change: Number(row?.regularMarketChangePercent || 0),
        volume: Number(row?.regularMarketVolume || 0),
      }));
      res.json({ data: rows.filter((x: any) => x.symbol && Number.isFinite(x.price) && x.price > 0) });
    } catch (_err) {
      res.status(502).json({ error: "Yahoo commodity quote unavailable" });
    }
  });

  // GET /api/proxy/stooq-quote?symbols=AAPL,TSLA&market=stocks|commodities
  // Public delayed quote fallback for stocks and commodities.
  app.get("/api/proxy/stooq-quote", async (req, res) => {
    const symbols = String(req.query.symbols || "");
    if (!symbols) return res.status(400).json({ error: "symbols required" });
    const market = String(req.query.market || "stocks");
    const isStocks = market !== "commodities";
    const list = symbols
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 200);
    if (list.length === 0) return res.json({ data: [] });

    try {
      const rows = await Promise.all(
        list.map(async (sym) => {
          const stooqSymbol = isStocks ? `${sym.toLowerCase()}.us` : sym.toLowerCase();
          const url = `https://stooq.com/q/l/?s=${encodeURIComponent(stooqSymbol)}&f=sd2t2ohlcv&e=csv`;
          const r = await fetch(url);
          const csv = await r.text();
          const line = csv.split(/\r?\n/).find((x) => x && !x.toLowerCase().includes("symbol"));
          if (!line) return null;
          const parts = line.split(",");
          const symRaw = String(parts[0] || "").toUpperCase().replace(".US", "");
          const open = Number(parts[3] || 0);
          const close = Number(parts[6] || 0);
          const volume = Number(parts[7] || 0);
          if (!symRaw || !Number.isFinite(close) || close <= 0) return null;
          const change = open > 0 ? ((close - open) / open) * 100 : 0;
          return {
            symbol: symRaw,
            price: close,
            change: Number.isFinite(change) ? change : 0,
            volume: Number.isFinite(volume) ? volume : 0,
          };
        }),
      );
      res.json({ data: rows.filter((x): x is { symbol: string; price: number; change: number; volume: number } => !!x && x.symbol && x.price > 0) });
    } catch (_err) {
      res.status(502).json({ error: "Stooq quote unavailable" });
    }
  });

  // GET /api/proxy/eod?symbols=AAPL,TSLA,...
  app.get("/api/proxy/eod", async (req, res) => {
    const key = process.env.TWELVE_DATA_API_KEY;
    if (!key) return res.status(503).json({ error: "TWELVE_DATA_API_KEY not set" });
    const symbols = req.query.symbols as string;
    if (!symbols) return res.status(400).json({ error: "symbols required" });
    try {
      const url = `https://api.twelvedata.com/eod?symbol=${encodeURIComponent(symbols)}&apikey=${key}`;
      const upstream = await fetch(url);
      const data = await upstream.json();
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: "Twelve Data unavailable" });
    }
  });

  // GET /api/proxy/symbols?type=stocks|commodities
  app.get("/api/proxy/symbols", async (req, res) => {
    const key = process.env.TWELVE_DATA_API_KEY;
    if (!key) return res.status(503).json({ error: "TWELVE_DATA_API_KEY not set" });
    const type = (req.query.type as string) || "stocks";
    const endpoint = type === "commodities" ? "commodities" : "stocks";
    const limitRaw = Number(req.query.limit ?? (endpoint === "stocks" ? 500 : 120));
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(10000, Math.floor(limitRaw))) : 500;
    try {
      const url =
        endpoint === "stocks"
          ? `https://api.twelvedata.com/stocks?exchange=NASDAQ&apikey=${key}`
          : `https://api.twelvedata.com/commodities?apikey=${key}`;
      const upstream = await fetch(url);
      const data = await upstream.json();
      const rows = Array.isArray((data as any)?.data) ? (data as any).data : [];
      res.json({ data: rows.slice(0, limit) });
    } catch (_err) {
      res.status(502).json({ error: `Twelve Data ${endpoint} unavailable` });
    }
  });

  // ── Groq AI Proxy ─────────────────────────────────────────────────────────
  // POST /api/proxy/ai-signal  body: { symbol, price, change, volume }
  app.post("/api/proxy/ai-signal", async (req, res) => {
    const key = process.env.VITE_GROQ_API_KEY;
    if (!key) return res.status(503).json({ error: "GROQ key not set" });
    try {
      const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: "llama3-8b-8192",
          messages: [
            { role: "system", content: "You are a trading signal engine. Respond with JSON only: {\"action\":\"BUY\"|\"SELL\"|\"HOLD\",\"confidence\":0.0-1.0,\"reason\":\"...\",\"suggestedStopLoss\":number|null,\"suggestedTakeProfit\":number|null}" },
            { role: "user", content: `Analyze: ${JSON.stringify(req.body)}` },
          ],
          max_tokens: 200,
          temperature: 0.2,
        }),
      });
      const data = await upstream.json();
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: "Groq unavailable" });
    }
  });

  // ── Twelve Data News Proxy ────────────────────────────────────────────────
  // GET /api/proxy/news?symbol=AAPL  (omit symbol for general market news)
  app.get("/api/proxy/news", async (req, res) => {
    const key = process.env.TWELVE_DATA_API_KEY;
    if (!key) return res.status(503).json({ error: "TWELVE_DATA_API_KEY not set" });
    const symbol = (req.query.symbol as string) || "";
    try {
      const symParam = symbol ? `&symbol=${encodeURIComponent(symbol)}` : "";
      const url = `https://api.twelvedata.com/news?apikey=${key}${symParam}&country=US&language=en`;
      const upstream = await fetch(url);
      if (!upstream.ok) return res.status(upstream.status).json({ error: "Twelve Data news error" });
      const data = await upstream.json();
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: "News fetch failed" });
    }
  });

  // ── AI News Stock Suggestion ──────────────────────────────────────────────
  // POST /api/proxy/news-suggest  body: { headlines: string[] }
  app.post("/api/proxy/news-suggest", async (req, res) => {
    const key = process.env.VITE_GROQ_API_KEY;
    if (!key) return res.status(503).json({ error: "GROQ key not set" });
    const { headlines } = req.body as { headlines: string[] };
    if (!headlines?.length) return res.status(400).json({ error: "headlines required" });
    try {
      const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: "llama3-8b-8192",
          messages: [
            {
              role: "system",
              content: `You are a financial analyst. Based on news headlines, suggest ONE stock or crypto to trade right now.
Respond with ONLY valid JSON (no markdown):
{
  "symbol": "TICKER",
  "action": "BUY" | "SELL",
  "confidence": 0.0-1.0,
  "reason": "2-3 sentence explanation based on the news",
  "category": "stock" | "crypto" | "commodity"
}`,
            },
            {
              role: "user",
              content: `Based on these market headlines, what is the best trade right now?\n\n${headlines.slice(0, 8).map((h, i) => `${i + 1}. ${h}`).join("\n")}`,
            },
          ],
          max_tokens: 300,
          temperature: 0.3,
        }),
      });
      const data = await upstream.json() as any;
      const raw = data?.choices?.[0]?.message?.content ?? "{}";
      // Strip markdown fences if present
      const clean = raw.replace(/```json|```/g, "").trim();
      try {
        res.json(JSON.parse(clean));
      } catch {
        res.json({ symbol: "UNKNOWN", action: "HOLD", confidence: 0, reason: raw, category: "stock" });
      }
    } catch (err) {
      res.status(502).json({ error: "Groq unavailable" });
    }
  });


  // ── Yahoo Finance v8 Chart Proxy (free, no API key) ──────────────────────
  // GET /api/proxy/yahoo-stocks?symbols=AAPL,TSLA,NVDA
  // GET /api/proxy/yahoo-commodities?symbols=XAUUSD,USOIL,WHEAT,...
  const COMMODITY_TO_YAHOO: Record<string, string> = {
    XAUUSD: "GC=F", XAGUSD: "SI=F", USOIL: "CL=F", BRENT: "BZ=F",
    NATGAS: "NG=F", COPPER: "HG=F", PLATINUM: "PL=F", PALLADIUM: "PA=F",
    WHEAT: "ZW=F", CORN: "ZC=F", SOYBEAN: "ZS=F", COFFEE: "KC=F",
    SUGAR: "SB=F", COCOA: "CC=F", COTTON: "CT=F", OJ: "OJ=F",
    GASOLINE: "RB=F", HEATING: "HO=F", CATTLE: "LE=F", HOGS: "HE=F",
  };

  async function fetchYahooChart(yahooTicker: string) {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?interval=1d&range=2d`;
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
    if (!r.ok) return null;
    const j = await r.json() as any;
    const meta = j?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const price = Number(meta.regularMarketPrice || 0);
    const prevClose = Number(meta.chartPreviousClose || 0);
    if (!Number.isFinite(price) || price <= 0) return null;
    const change = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
    const volume = Number(meta.regularMarketVolume || 0);
    return {
      price,
      change: Number.isFinite(change) ? change : 0,
      volume: Number.isFinite(volume) ? volume : 0,
    };
  }

  app.get("/api/proxy/yahoo-stocks", async (req, res) => {
    const symbols = String(req.query.symbols || "");
    if (!symbols) return res.status(400).json({ error: "symbols required" });
    const list = symbols
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 60);
    if (list.length === 0) return res.json({ data: [] });

    try {
      const rows = await Promise.all(
        list.map(async (sym) => {
          try {
            const data = await fetchYahooChart(sym);
            if (!data) return null;
            return { symbol: sym, ...data };
          } catch {
            return null;
          }
        }),
      );
      res.json({
        data: rows.filter(
          (x): x is { symbol: string; price: number; change: number; volume: number } =>
            !!x && x.price > 0,
        ),
      });
    } catch (_err) {
      res.status(502).json({ error: "Yahoo Finance unavailable" });
    }
  });

  // GET /api/proxy/yahoo-commodities?symbols=XAUUSD,USOIL,WHEAT,...
  app.get("/api/proxy/yahoo-commodities", async (req, res) => {
    const symbols = String(req.query.symbols || "");
    if (!symbols) return res.status(400).json({ error: "symbols required" });
    const list = symbols
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 60);
    if (list.length === 0) return res.json({ data: [] });

    try {
      const rows = await Promise.all(
        list.map(async (appSym) => {
          try {
            const yahooTicker = COMMODITY_TO_YAHOO[appSym];
            if (!yahooTicker) return null;
            const data = await fetchYahooChart(yahooTicker);
            if (!data) return null;
            return { symbol: appSym, ...data };
          } catch {
            return null;
          }
        }),
      );
      res.json({
        data: rows.filter(
          (x): x is { symbol: string; price: number; change: number; volume: number } =>
            !!x && x.price > 0,
        ),
      });
    } catch (_err) {
      res.status(502).json({ error: "Yahoo Finance unavailable" });
    }
  });

  // ── Vite / Static ─────────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const startListening = (port: number) => {
    const server = app.listen(port, host, () => {
      if (port !== basePort) {
        console.log(`Port ${basePort} is in use; switched to ${port}.`);
      }
      console.log(`Tradify running on http://localhost:${port}`);
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        startListening(port + 1);
        return;
      }
      throw err;
    });
  };

  startListening(basePort);
}

startServer();

