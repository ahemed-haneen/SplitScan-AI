import { GoogleGenAI, Type } from "@google/genai";
import { ReceiptData } from "../types";

export async function scanReceipt(base64Image: string, mimeType: string): Promise<ReceiptData> {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  console.log("Starting receipt scan with Gemini...", { mimeType, imageLength: base64Image.length });
  
  const ai = new GoogleGenAI({ apiKey: geminiApiKey });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          {
            text: `Extract information from this receipt image. 
            CONTEXT: 
            - The current year is 2026. If the year on the receipt is ambiguous or truncated (e.g., "26"), it refers to 2026.
            - Dates are likely in DD/MM/YYYY format.
            Focus on the merchant name, date (YYYY-MM-DD), total amount, currency, and line items if possible. 
            Return the data in valid JSON format according to the schema.`,
          },
          {
            inlineData: {
              data: base64Image.includes(",") ? base64Image.split(",")[1] : base64Image,
              mimeType: mimeType,
            },
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            merchant: { type: Type.STRING },
            date: { type: Type.STRING, description: "Format: YYYY-MM-DD" },
            total: { type: Type.NUMBER },
            currency: { type: Type.STRING, description: "3-letter currency code, e.g., USD, EUR" },
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  price: { type: Type.NUMBER },
                  description: { type: Type.STRING },
                },
                required: ["name", "price"],
              },
            },
          },
          required: ["merchant", "total", "currency"],
        },
      },
    });

    const text = response.text;
    console.log("Gemini response received:", text);
    
    if (!text) throw new Error("No response from Gemini");
    
    const jsonStr = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    return JSON.parse(jsonStr) as ReceiptData;
  } catch (error: any) {
    console.error("Gemini scanning error details:", error);
    throw error;
  }
}

export async function translateText(text: string): Promise<string> {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const ai = new GoogleGenAI({ apiKey: geminiApiKey });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          {
            text: `Translate the following text to English. If it is already in English, return it as is. Context: This is an item name from a shopping receipt. Return only the translated text.\n\nText: ${text}`,
          },
        ],
      },
    });

    return response.text.trim();
  } catch (error: any) {
    console.error("Gemini translation error:", error);
    return text;
  }
}
