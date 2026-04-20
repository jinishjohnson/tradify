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
      const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbols)}&apikey=${key}`;
      const upstream = await fetch(url);
      const data = await upstream.json();
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: "Twelve Data unavailable" });
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

