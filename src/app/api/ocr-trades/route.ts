// src/app/api/ocr-trades/route.ts
// Recibe una imagen en base64, la manda a la Anthropic Vision API y
// devuelve un array de trades parseados listos para insertar en Supabase.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

interface TradeExtraido {
  symbol: string;
  side: "long" | "short";
  quantity: number;
  entry_price: number;
  exit_price: number | null;
  entry_time: string;
  exit_time: string | null;
  realized_pnl: number | null;
  fees: number;
}

const PROMPT = `Analizás esta captura de pantalla de una plataforma de trading.

CASO 1 — Si ves una tabla de RESUMEN DIARIO de Lucid Trading (columnas: DATE, SYMBOL, NET PNL, PNL HIGH, PNL LOW, QTY, COMMISSION, AVG WIN, AVG LOSS, WIN DURATION, LOSS DURATION, WIN %):
Para cada fila devolvé:
- symbol: string (columna SYMBOL — ej: "MNQZ6", "MNQ")
- side: "long" (por defecto; la vista diaria no muestra dirección individual)
- quantity: number (columna QTY — total de contratos del día, siempre positivo)
- entry_price: 0 (no disponible en vista diaria de Lucid)
- exit_price: null
- entry_time: string (columna DATE convertida a ISO 8601 con mediodía — ej: "09/24/2026" → "2026-09-24T12:00:00")
- exit_time: string (misma fecha con hora T13:00:00 — ej: "2026-09-24T13:00:00")
- realized_pnl: number (columna NET PNL — ya descontada la comisión; ej: "$34.50" → 34.5, "-$21.50" → -21.5)
- fees: number (columna COMMISSION — siempre positivo; ej: "$2.00" → 2.0)

CASO 2 — Si ves una tabla de OPERACIONES INDIVIDUALES (Tradovate, MT4/MT5, NinjaTrader, etc. con columnas de precio de entrada/salida):
Para cada operación devolvé:
- symbol: string (símbolo del activo)
- side: "long" o "short" (Buy/compra = "long", Sell/venta = "short")
- quantity: number (contratos, lotes o acciones — siempre positivo)
- entry_price: number (precio de entrada/apertura)
- exit_price: number o null (precio de salida, null si está abierta)
- entry_time: string (fecha y hora de entrada ISO 8601 — ej: "2024-01-15T09:30:00"; null si no se ve)
- exit_time: string o null (fecha y hora de salida; null si no se ve)
- realized_pnl: number o null (P&L realizado en USD; null si está abierta)
- fees: number (comisión — 0 si no se muestra)

REGLAS PARA AMBOS CASOS:
- Devolvé SOLAMENTE un array JSON válido, sin texto adicional, sin comentarios, sin bloques markdown.
- Si no encontrás ninguna fila/operación, devolvé un array vacío: []
- No inventes datos — usá exactamente los números que ves en la imagen.
- Para fechas en formato MM/DD/YYYY: convertí a YYYY-MM-DDT12:00:00
- Para NET PNL en Lucid: el valor ya es neto (fees ya descontados) — transcribilo tal cual

Ejemplo respuesta para tabla diaria de Lucid:
[{"symbol":"MNQZ6","side":"long","quantity":2,"entry_price":0,"exit_price":null,"entry_time":"2026-09-24T12:00:00","exit_time":"2026-09-24T13:00:00","realized_pnl":34.50,"fees":2.00},{"symbol":"MNQZ6","side":"long","quantity":4,"entry_price":0,"exit_price":null,"entry_time":"2026-09-23T12:00:00","exit_time":"2026-09-23T13:00:00","realized_pnl":370.00,"fees":4.00}]

Ejemplo respuesta para tabla de trades individuales:
[{"symbol":"MNQ","side":"long","quantity":2,"entry_price":19500.25,"exit_price":19520.00,"entry_time":"2024-01-15T09:30:00","exit_time":"2024-01-15T09:45:00","realized_pnl":39.50,"fees":1.24}]`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY no está configurada en el servidor. Agregala en tu .env.local y en Vercel." },
      { status: 500 }
    );
  }

  let body: { imageBase64?: string; mimeType?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "El cuerpo de la petición no es JSON válido." }, { status: 400 });
  }

  const { imageBase64, mimeType } = body;

  if (!imageBase64 || typeof imageBase64 !== "string") {
    return NextResponse.json({ error: "Falta el campo imageBase64." }, { status: 400 });
  }

  const tipoValido = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  const mediaType = tipoValido.includes(mimeType ?? "") ? mimeType! : "image/png";

  let responseData: { content?: { type: string; text?: string }[] };
  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: imageBase64,
                },
              },
              {
                type: "text",
                text: PROMPT,
              },
            ],
          },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const errorText = await anthropicRes.text();
      console.error("[ocr-trades] Error de Anthropic:", errorText);
      return NextResponse.json(
        { error: `La API de Anthropic devolvió un error (${anthropicRes.status}). Revisá que ANTHROPIC_API_KEY sea válida.` },
        { status: 502 }
      );
    }

    responseData = await anthropicRes.json();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ocr-trades] Error de red:", msg);
    return NextResponse.json({ error: `No se pudo conectar con la API de Anthropic: ${msg}` }, { status: 502 });
  }

  const rawText = responseData.content?.find((c) => c.type === "text")?.text ?? "";

  // Limpiar posibles bloques de markdown que el modelo pueda agregar
  const jsonText = rawText
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim();

  let trades: TradeExtraido[];
  try {
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) {
      throw new Error("La respuesta no es un array");
    }
    trades = parsed;
  } catch (e) {
    console.error("[ocr-trades] No se pudo parsear la respuesta:", rawText);
    return NextResponse.json(
      {
        error:
          "La IA no pudo extraer operaciones de esa imagen. Intentá con una captura más clara de la tabla, asegurate que sea la vista Trading History de Lucid o la tabla de trades cerrados de tu plataforma.",
        rawResponse: rawText,
      },
      { status: 422 }
    );
  }

  return NextResponse.json({ trades });
}