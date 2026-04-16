import { GoogleGenAI, Type } from "@google/genai";
import { MarketData, AISignal } from "../types/trading";

// Note: process.env.GEMINI_API_KEY is provided by the environment
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function getTradingSignal(marketData: MarketData): Promise<AISignal> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `
        Analyze the following market data for ${marketData.symbol}:
        Current Price: $${marketData.price}
        Daily Change: ${marketData.change}%
        Volume: ${marketData.volume}
        
        Act as a professional algorithmic trading advisor. 
        Provide a trading signal with suggested stop-loss and take-profit levels.
        The stop-loss should be roughly 1-2% away from the current price.
        The take-profit should be roughly 3-5% away from current price.
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            symbol: { type: Type.STRING },
            action: { type: Type.STRING, enum: ["BUY", "SELL", "HOLD"] },
            confidence: { type: Type.NUMBER },
            reasoning: { type: Type.STRING },
            suggestedStopLoss: { type: Type.NUMBER },
            suggestedTakeProfit: { type: Type.NUMBER },
          },
          required: ["symbol", "action", "confidence", "reasoning", "suggestedStopLoss", "suggestedTakeProfit"],
        },
      },
    });

    const signal = JSON.parse(response.text || "{}");
    return {
      ...signal,
      symbol: marketData.symbol,
    };
  } catch (error) {
    console.error("AI Signal Error:", error);
    return {
      symbol: marketData.symbol,
      action: "HOLD",
      confidence: 0,
      reasoning: "AI analysis failed, safe mode activated.",
      suggestedStopLoss: marketData.price * 0.98,
      suggestedTakeProfit: marketData.price * 1.05,
    };
  }
}

export async function getMarketRecommendations(marketData: MarketData[]): Promise<AISignal[]> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `
        Analyze the following market overview:
        ${JSON.stringify(marketData.map(d => ({ symbol: d.symbol, price: d.price, change: d.change })))}
        
        Act as a high-frequency trading analyst. 
        Identify the Top 2 most promising 'BUY' opportunities for "massive gains" in the next few hours.
        Return their symbols, a short reasoning (max 60 chars), and take-profit targets.
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              symbol: { type: Type.STRING },
              action: { type: Type.STRING, enum: ["BUY"] },
              confidence: { type: Type.NUMBER },
              reasoning: { type: Type.STRING },
              targetPrice: { type: Type.NUMBER },
            },
            required: ["symbol", "action", "confidence", "reasoning", "targetPrice"],
          },
        },
      },
    });

    return JSON.parse(response.text || "[]");
  } catch (error) {
    console.error("AI Recommendation Error:", error);
    return [];
  }
}
