import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Mock Market Data API
  app.get("/api/market/ticker/:symbol", (req, res) => {
    const { symbol } = req.params;
    // Simulated price data
    const price = 150 + Math.random() * 10;
    res.json({
      symbol: symbol.toUpperCase(),
      price: price.toFixed(2),
      change: (Math.random() * 2 - 1).toFixed(2),
      volume: Math.floor(Math.random() * 1000000),
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Zenith AI Trader running on http://localhost:${PORT}`);
  });
}

startServer();
