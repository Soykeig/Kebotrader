// src/lib/supabase.ts
// Cliente único de Supabase para toda la aplicación KeboTrade.
// Se usa la clave pública ("anon key"), nunca la "service_role" key
// en el frontend: la privacidad de los datos la garantiza el RLS
// que ya configuramos en la base de datos.

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Faltan las variables de entorno de Supabase. Revisa tu archivo .env.local"
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// ---------------------------------------------------------------------
// Tipos compartidos con el resto de la app (coinciden con el esquema SQL)
// ---------------------------------------------------------------------

export type InstrumentType = "stock" | "option" | "crypto" | "forex" | "futures";
export type OptionType = "call" | "put";
export type TradeSide = "long" | "short";
export type TradeStatus = "open" | "closed";
export type ResultType = "tp" | "sl" | "manual" | "breakeven";

export const RESULT_LABELS: Record<ResultType, string> = {
  tp: "Take Profit",
  sl: "Stop Loss",
  manual: "Cierre manual",
  breakeven: "Empate (breakeven)",
};

export type TradingSession = "asia" | "londres" | "nueva_york" | "apertura_ny";

export const SESSION_LABELS: Record<TradingSession, string> = {
  asia: "Asia",
  londres: "Londres",
  nueva_york: "Nueva York",
  apertura_ny: "Apertura NY",
};

// ---- Psicología de trading: emoción y error cometido ----------------

export type EmotionType =
  | "disciplinado"
  | "confiado"
  | "ansioso"
  | "fomo"
  | "revancha"
  | "impaciente"
  | "neutral";

export const EMOTION_LABELS: Record<EmotionType, string> = {
  disciplinado: "Disciplinado",
  confiado: "Confiado",
  ansioso: "Ansioso",
  fomo: "FOMO",
  revancha: "Revancha",
  impaciente: "Impaciente",
  neutral: "Neutral",
};

// Emoji de apoyo visual para tags de emoción (tabla e insights)
export const EMOTION_EMOJI: Record<EmotionType, string> = {
  disciplinado: "🎯",
  confiado: "💪",
  ansioso: "😰",
  fomo: "🏃",
  revancha: "🔥",
  impaciente: "⏱️",
  neutral: "😐",
};

export type MistakeType =
  | "ninguno"
  | "entrada_temprana"
  | "entrada_tardia"
  | "sin_stop"
  | "movio_stop"
  | "sobre_apalancado"
  | "rompio_regla_riesgo"
  | "cerro_temprano"
  | "over_trading"
  | "no_confirmacion";

export const MISTAKE_LABELS: Record<MistakeType, string> = {
  ninguno: "Ninguno",
  entrada_temprana: "Entrada temprana",
  entrada_tardia: "Entrada tardía",
  sin_stop: "Sin stop loss",
  movio_stop: "Movió el stop",
  sobre_apalancado: "Sobre-apalancado",
  rompio_regla_riesgo: "Rompió regla de riesgo",
  cerro_temprano: "Cerró muy temprano",
  over_trading: "Overtrading",
  no_confirmacion: "Sin confirmación",
};

export interface Trade {
  id: string;
  user_id: string;
  account_id: string | null;
  strategy_id: string | null;
  symbol: string;
  instrument_type: InstrumentType;
  side: TradeSide;
  status: TradeStatus;
  quantity: number;
  entry_price: number;
  exit_price: number | null;
  entry_time: string;
  exit_time: string | null;
  fees: number;
  option_type: OptionType | null;
  strike_price: number | null;
  expiration_date: string | null;
  realized_pnl: number | null;
  result_type: ResultType | null;
  pips: number | null;
  session: TradingSession | null;
  tradingview_link: string | null;
  notes: string | null;
  emotion: EmotionType | null;
  mistake: MistakeType | null;
  risk_amount: number | null;
  tradingview_links: string[];
  created_at: string;
  updated_at: string;
}

export type NewTrade = Pick<
  Trade,
  | "symbol"
  | "instrument_type"
  | "side"
  | "status"
  | "quantity"
  | "entry_price"
  | "exit_price"
  | "entry_time"
  | "exit_time"
  | "fees"
  | "notes"
>;

export interface Strategy {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  color: string | null;
  rules: string[];
  created_at: string;
}

export type AccountType = "demo" | "real";
export type AccountPhase = "fase_1" | "fase_2" | "financiada" | "no_aplica";

export const PHASE_LABELS: Record<AccountPhase, string> = {
  fase_1: "Fase 1",
  fase_2: "Fase 2",
  financiada: "Financiada",
  no_aplica: "No aplica",
};

export interface Account {
  id: string;
  user_id: string;
  name: string;
  broker: string | null;
  currency: string;
  starting_balance: number;
  purchase_cost: number | null;
  account_type: AccountType;
  phase: AccountPhase;
  description: string | null;
  max_daily_loss: number | null;
  max_total_loss: number | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface Withdrawal {
  id: string;
  user_id: string;
  account_id: string;
  amount: number;
  withdrawal_date: string;
  notes: string | null;
  created_at: string;
}

export type AchievementCategory = "fondeo" | "retiro" | "otro";

export const ACHIEVEMENT_CATEGORY_LABELS: Record<AchievementCategory, string> = {
  fondeo: "Certificado de fondeo",
  retiro: "Certificado de retiro",
  otro: "Otro logro",
};

export interface Achievement {
  id: string;
  user_id: string;
  account_id: string | null;
  title: string;
  description: string | null;
  file_url: string | null;
  category: AchievementCategory;
  achieved_date: string;
  created_at: string;
}

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  trading_style: string | null;
  started_year: number | null;
  location: string | null;
  updated_at: string;
}

export interface ChecklistItem {
  id: string;
  user_id: string;
  text: string;
  sort_order: number;
  created_at: string;
}

export interface ChecklistLog {
  id: string;
  user_id: string;
  item_id: string;
  log_date: string;
  completed: boolean;
  created_at: string;
}