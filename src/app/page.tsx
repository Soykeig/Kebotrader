// src/app/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState, FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  supabase,
  type Trade,
  type InstrumentType,
  type TradeSide,
  type Strategy,
  type Account,
  type AccountType,
  type AccountPhase,
  type ResultType,
  type TradingSession,
  type EmotionType,
  type MistakeType,
  type Withdrawal,
  type Achievement,
  type AchievementCategory,
  type Profile,
  type ChecklistItem,
  ACHIEVEMENT_CATEGORY_LABELS,
  PHASE_LABELS,
  RESULT_LABELS,
  SESSION_LABELS,
  EMOTION_LABELS,
  EMOTION_EMOJI,
  MISTAKE_LABELS,
} from "@/lib/supabase";

// =====================================================================
// Utilidades
// =====================================================================

function formatCurrency(value: number): string {
  return value.toLocaleString("es-ES", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Formatea un precio de mercado (cotización), no una cifra de dinero.
 * Sin símbolo de moneda y con más decimales, ya que en forex el precio
 * de entrada/salida (ej. 1.14500) necesita esa precisión para ser útil.
 */
function formatPrice(value: number): string {
  const decimales = Math.abs(value) < 50 ? 5 : 2;
  return value.toLocaleString("es-ES", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function todayKey(): string {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(
    hoy.getDate()
  ).padStart(2, "0")}`;
}

/** Calcula el R-múltiplo: cuántas veces el riesgo se ganó o perdió. */
/**
 * Ejecuta una operación de Supabase con un reintento automático si falla
 * la primera vez (por ejemplo, un corte de internet momentáneo). Espera
 * un toque antes de reintentar para no golpear la red en el mismo
 * instante que falló.
 */
async function conReintento<T>(
  operacion: () => PromiseLike<{ data: T | null; error: { message: string } | null }>
): Promise<{ data: T | null; error: { message: string } | null; reintentado: boolean }> {
  const primerIntento = await operacion();
  if (!primerIntento.error) {
    return { ...primerIntento, reintentado: false };
  }

  await new Promise((resolve) => setTimeout(resolve, 800));
  const segundoIntento = await operacion();
  return { ...segundoIntento, reintentado: true };
}

function calcularRMultiple(pnl: number | null, riskAmount: number | null): number | null {
  if (pnl === null || riskAmount === null || riskAmount <= 0) return null;
  return pnl / riskAmount;
}

function formatRMultiple(r: number | null): string {
  if (r === null) return "—";
  return `${r >= 0 ? "+" : ""}${r.toFixed(2)}R`;
}

// =====================================================================
// LOGO
// =====================================================================

function LogoKTrader({ size = 32 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo-ktrader.png"
      alt="Logo de KeboTrader"
      width={size}
      height={size}
      className="shrink-0 rounded-md object-cover"
      style={{ width: size, height: size }}
    />
  );
}

const INSTRUMENT_LABELS: Record<InstrumentType, string> = {
  stock: "Acción",
  option: "Opción",
  crypto: "Cripto",
  forex: "Forex",
  futures: "Futuros",
};

// =====================================================================
// Componente principal
// =====================================================================

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCheckingSession(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  if (checkingSession) {
    return (
      <main
        className="min-h-screen bg-kb-bg flex items-center justify-center"
        suppressHydrationWarning
      >
        <p className="text-kb-text-secondary font-mono text-sm tracking-wide">
          Cargando KeboTrader…
        </p>
      </main>
    );
  }

  return session ? <Dashboard session={session} /> : <LandingConAuth />;
}

// =====================================================================
// LANDING PAGE + AUTENTICACIÓN (usuario no logueado)
// =====================================================================

function LandingConAuth() {
  const [mostrarAuth, setMostrarAuth] = useState(false);

  return (
    <main className="min-h-screen bg-kb-bg text-kb-text" suppressHydrationWarning>
      <header className="border-b border-kb-border-soft">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2.5">
            <div className="relative flex items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-kb-gain/20 blur-md" />
              <LogoKTrader size={36} />
            </div>
            <span className="font-display text-xl font-bold tracking-tight">
              Kebo<span className="text-kb-gain">Trader</span>
            </span>
          </div>
          <button
            onClick={() => setMostrarAuth(true)}
            className="rounded-lg border border-kb-border px-4 py-2 text-sm font-medium text-kb-text hover:border-kb-accent hover:text-kb-accent transition-colors"
          >
            Iniciar sesión
          </button>
        </div>
      </header>

      <div className="overflow-hidden border-b border-kb-border-soft bg-kb-surface/40 py-2">
        <TickerTape />
      </div>

      <section className="mx-auto max-w-6xl px-6 py-20 text-center">
        <p className="mb-4 inline-block rounded-full border border-kb-border px-3 py-1 text-xs font-mono text-kb-text-secondary">
          Gratis · Privado · Sin tarjeta de crédito
        </p>
        <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight leading-[1.05]">
          Cada operación cuenta
          <br />
          <span className="text-kb-accent">una historia.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-base sm:text-lg text-kb-text-secondary">
          KeboTrader es tu diario de trading. Registra cada operación, calcula
          tu rendimiento al instante y descubre los patrones que de verdad
          mueven tu cuenta.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <button
            onClick={() => setMostrarAuth(true)}
            className="rounded-lg bg-kb-accent px-6 py-3 text-sm font-semibold text-kb-bg hover:brightness-110 transition"
          >
            Crear mi diario gratis
          </button>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16 border-t border-kb-border-soft">
        <div className="grid gap-6 sm:grid-cols-3">
          <FeatureCard
            titulo="Registro detallado"
            texto="Acciones, opciones, cripto, forex y futuros. Cada campo que importa, sin ruido."
          />
          <FeatureCard
            titulo="P&L automático"
            texto="El cálculo de ganancias y pérdidas se hace solo, en cuanto cierras la operación."
          />
          <FeatureCard
            titulo="100% privado"
            texto="Tus operaciones son tuyas. Nadie más puede verlas, ni siquiera entre usuarios de KeboTrader."
          />
        </div>
      </section>

      <footer className="border-t border-kb-border-soft py-8 text-center text-xs text-kb-text-muted">
        © {new Date().getFullYear()} KeboTrader. Hecho para traders que se toman en serio su progreso.
      </footer>

      {mostrarAuth && <ModalAuth onClose={() => setMostrarAuth(false)} />}
    </main>
  );
}

function FeatureCard({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="rounded-xl border border-kb-border bg-kb-surface p-6">
      <h3 className="font-display text-lg font-semibold">{titulo}</h3>
      <p className="mt-2 text-sm text-kb-text-secondary">{texto}</p>
    </div>
  );
}

function TickerTape() {
  const items = [
    { sym: "AAPL", pnl: 2.34 },
    { sym: "TSLA", pnl: -1.12 },
    { sym: "SPY", pnl: 0.58 },
    { sym: "NVDA", pnl: 4.21 },
    { sym: "MSFT", pnl: -0.41 },
    { sym: "BTC", pnl: 1.95 },
    { sym: "EUR/USD", pnl: 0.12 },
    { sym: "QQQ", pnl: 0.87 },
  ];
  const doble = [...items, ...items];

  return (
    <div className="flex w-max animate-[ticker_28s_linear_infinite] gap-10 whitespace-nowrap font-mono text-sm">
      <style>{`
        @keyframes ticker {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
      `}</style>
      {doble.map((it, i) => (
        <span key={i} className="flex items-center gap-2 px-2">
          <span className="text-kb-text-secondary">{it.sym}</span>
          <span className={it.pnl >= 0 ? "text-kb-gain" : "text-kb-loss"}>
            {it.pnl >= 0 ? "▲" : "▼"} {Math.abs(it.pnl).toFixed(2)}%
          </span>
        </span>
      ))}
    </div>
  );
}

// =====================================================================
// MODAL DE AUTENTICACIÓN (Login / Registro)
// =====================================================================

function ModalAuth({ onClose }: { onClose: () => void }) {
  const [modo, setModo] = useState<"login" | "registro">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMensaje(null);
    setCargando(true);

    try {
      if (modo === "registro") {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        });
        if (signUpError) throw signUpError;
        setMensaje(
          "¡Cuenta creada! Revisa tu correo para confirmar tu registro antes de iniciar sesión."
        );
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        onClose();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ocurrió un error inesperado.";
      setError(traducirErrorAuth(msg));
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-kb-border bg-kb-surface p-7 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">
            {modo === "login" ? "Iniciar sesión" : "Crear cuenta"}
          </h2>
          <button
            onClick={onClose}
            className="text-kb-text-muted hover:text-kb-text transition"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-kb-text-secondary">
              Correo electrónico
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-kb-border bg-kb-bg px-3 py-2 text-sm text-kb-text outline-none focus:border-kb-accent"
              placeholder="tu@correo.com"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-kb-text-secondary">
              Contraseña
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-kb-border bg-kb-bg px-3 py-2 text-sm text-kb-text outline-none focus:border-kb-accent"
              placeholder="Mínimo 6 caracteres"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-kb-loss/30 bg-kb-loss/10 px-3 py-2 text-xs text-kb-loss">
              {error}
            </p>
          )}
          {mensaje && (
            <p className="rounded-lg border border-kb-gain/30 bg-kb-gain/10 px-3 py-2 text-xs text-kb-gain">
              {mensaje}
            </p>
          )}

          <button
            type="submit"
            disabled={cargando}
            className="w-full rounded-lg bg-kb-accent py-2.5 text-sm font-semibold text-kb-bg hover:brightness-110 transition disabled:opacity-60"
          >
            {cargando
              ? "Procesando…"
              : modo === "login"
              ? "Entrar"
              : "Registrarme"}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-kb-text-secondary">
          {modo === "login" ? "¿No tienes cuenta todavía? " : "¿Ya tienes una cuenta? "}
          <button
            onClick={() => {
              setModo(modo === "login" ? "registro" : "login");
              setError(null);
              setMensaje(null);
            }}
            className="font-semibold text-kb-accent hover:underline"
          >
            {modo === "login" ? "Regístrate" : "Inicia sesión"}
          </button>
        </p>
      </div>
    </div>
  );
}

function traducirErrorAuth(msg: string): string {
  if (msg.includes("Invalid login credentials")) {
    return "Correo o contraseña incorrectos.";
  }
  if (msg.includes("User already registered")) {
    return "Ya existe una cuenta con ese correo.";
  }
  if (msg.toLowerCase().includes("password")) {
    return "La contraseña debe tener al menos 6 caracteres.";
  }
  return msg;
}

// =====================================================================
// NAVEGACIÓN: tipos de vista disponibles en el dashboard
// =====================================================================

type Vista =
  | "inicio"
  | "historial"
  | "calendario"
  | "reportes"
  | "estrategias"
  | "configuracion"
  | "roi"
  | "retiros"
  | "logros"
  | "perfil";
type CuentaSeleccion = string | "todas";

interface NavItem {
  id: Vista;
  etiqueta: string;
  icono: string;
}

interface NavGrupo {
  titulo: string;
  items: NavItem[];
}

const NAV_GRUPOS: NavGrupo[] = [
  {
    titulo: "General",
    items: [
      { id: "inicio", etiqueta: "Dashboard", icono: "📊" },
      { id: "historial", etiqueta: "Trades", icono: "📈" },
      { id: "calendario", etiqueta: "Calendario", icono: "📅" },
      { id: "reportes", etiqueta: "Métricas", icono: "📉" },
    ],
  },
  {
    titulo: "Capital",
    items: [
      { id: "estrategias", etiqueta: "Estrategias", icono: "🎯" },
      { id: "configuracion", etiqueta: "Cuentas", icono: "👤" },
      { id: "roi", etiqueta: "ROI de Cuentas", icono: "💲" },
      { id: "retiros", etiqueta: "Retiros", icono: "🕓" },
      { id: "logros", etiqueta: "Logros", icono: "🏆" },
    ],
  },
  {
    titulo: "Cuenta",
    items: [{ id: "perfil", etiqueta: "Perfil", icono: "⚙️" }],
  },
];

const NAV_ITEMS: NavItem[] = NAV_GRUPOS.flatMap((g) => g.items);

const MAPA_NUMERO_ITEM = new Map(NAV_ITEMS.map((item, i) => [item.id, String(i + 1).padStart(2, "0")]));
function numeroDeItem(id: Vista): string {
  return MAPA_NUMERO_ITEM.get(id) ?? "";
}

/** Deriva un nombre legible a partir del correo (ej. "juan.perez@x.com" → "Juan.perez") */
function nombreDesdeEmail(email: string | undefined): string {
  if (!email) return "Trader";
  const local = email.split("@")[0];
  return local.charAt(0).toUpperCase() + local.slice(1);
}

// =====================================================================
// SELECTOR DE CUENTA EN EL SIDEBAR — dropdown con equity total,
// como en TradeLog: siempre visible, sin importar la sección activa
// =====================================================================

function SelectorCuentaSidebar({
  cuentas,
  cargando,
  cuentaActivaId,
  pnlPorCuenta,
  onSeleccionar,
  onNuevaCuenta,
}: {
  cuentas: Account[];
  cargando: boolean;
  cuentaActivaId: CuentaSeleccion;
  pnlPorCuenta: Map<string, number>;
  onSeleccionar: (id: CuentaSeleccion) => void;
  onNuevaCuenta: () => void;
}) {
  const [abierto, setAbierto] = useState(false);

  const equityTotal = cuentas.reduce(
    (acc, c) => acc + c.starting_balance + (pnlPorCuenta.get(c.id) ?? 0),
    0
  );

  const cuentaActiva = cuentaActivaId === "todas" ? null : cuentas.find((c) => c.id === cuentaActivaId);
  const equityMostrado =
    cuentaActivaId === "todas"
      ? equityTotal
      : cuentaActiva
      ? cuentaActiva.starting_balance + (pnlPorCuenta.get(cuentaActiva.id) ?? 0)
      : 0;

  return (
    <div className="relative border-b border-kb-border-soft px-3 py-3">
      <button
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left hover:bg-kb-surface transition-colors"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-kb-gain" />
            <p className="truncate text-sm font-semibold text-kb-text">
              {cargando ? "Cargando…" : cuentaActivaId === "todas" ? "Todas las cuentas" : cuentaActiva?.name ?? "Sin cuenta"}
            </p>
          </div>
          <p className="mt-0.5 text-[11px] text-kb-text-muted">
            {cuentas.length} cuenta{cuentas.length === 1 ? "" : "s"} activa{cuentas.length === 1 ? "" : "s"}
          </p>
        </div>
        <span className={`shrink-0 text-kb-text-muted transition-transform ${abierto ? "rotate-180" : ""}`}>
          ⌄
        </span>
      </button>

      <div className="mt-2 px-2">
        <p className="text-[10px] uppercase tracking-wide text-kb-text-muted">Equity {cuentaActivaId === "todas" ? "total" : ""}</p>
        <p className={`font-mono text-lg font-semibold ${equityMostrado >= 0 ? "text-kb-text" : "text-kb-loss"}`}>
          {formatCurrency(equityMostrado)}
        </p>
      </div>

      {abierto && (
        <div className="absolute left-3 right-3 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-kb-border bg-kb-surface-raised shadow-xl">
          <button
            onClick={() => {
              onSeleccionar("todas");
              setAbierto(false);
            }}
            className={`block w-full px-3 py-2.5 text-left text-xs font-medium transition-colors ${
              cuentaActivaId === "todas" ? "bg-kb-accent/10 text-kb-accent" : "text-kb-text hover:bg-kb-bg"
            }`}
          >
            📊 Todas las cuentas
          </button>
          {cuentas.map((c) => {
            const pnl = pnlPorCuenta.get(c.id) ?? 0;
            return (
              <button
                key={c.id}
                onClick={() => {
                  onSeleccionar(c.id);
                  setAbierto(false);
                }}
                className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-xs font-medium transition-colors ${
                  c.id === cuentaActivaId ? "bg-kb-accent/10 text-kb-accent" : "text-kb-text hover:bg-kb-bg"
                }`}
              >
                <span className="flex items-center gap-1.5 truncate">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      c.account_type === "real" ? "bg-kb-loss" : "bg-kb-gain"
                    }`}
                  />
                  <span className="truncate">{c.name}</span>
                </span>
                <span className={`shrink-0 font-mono ${pnl >= 0 ? "text-kb-gain" : "text-kb-loss"}`}>
                  {pnl >= 0 ? "+" : ""}
                  {formatCurrency(pnl)}
                </span>
              </button>
            );
          })}
          <button
            onClick={() => {
              onNuevaCuenta();
              setAbierto(false);
            }}
            className="block w-full border-t border-kb-border-soft px-3 py-2.5 text-left text-xs font-medium text-kb-accent hover:bg-kb-bg transition-colors"
          >
            + Nueva cuenta
          </button>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// DASHBOARD (usuario logueado)
// =====================================================================

function Dashboard({ session }: { session: Session }) {
  const [vista, setVista] = useState<Vista>("inicio");
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false);

  const [cuentas, setCuentas] = useState<Account[]>([]);
  const [cuentaActivaId, setCuentaActivaId] = useState<CuentaSeleccion>("todas");
  const [cargandoCuentas, setCargandoCuentas] = useState(true);
  const [mostrarModalCuenta, setMostrarModalCuenta] = useState(false);
  const [mostrarArchivadas, setMostrarArchivadas] = useState(false);
  const [diaParaRegistrar, setDiaParaRegistrar] = useState<string>(() => todayKey());

  const [trades, setTrades] = useState<Trade[]>([]);
  const [estrategias, setEstrategias] = useState<Strategy[]>([]);
  const [cargandoTrades, setCargandoTrades] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const [retiros, setRetiros] = useState<Withdrawal[]>([]);
  const [cargandoRetiros, setCargandoRetiros] = useState(true);

  const [logros, setLogros] = useState<Achievement[]>([]);
  const [cargandoLogros, setCargandoLogros] = useState(true);

  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [checklistCompletados, setChecklistCompletados] = useState<Set<string>>(new Set());
  const [cargandoChecklist, setCargandoChecklist] = useState(true);

  async function cargarCuentas() {
    setCargandoCuentas(true);
    const { data } = await supabase
      .from("accounts")
      .select("*")
      .eq("is_archived", false)
      .order("created_at", { ascending: true });

    const lista = (data as Account[]) ?? [];
    setCuentas(lista);
    setCargandoCuentas(false);
  }

  async function cargarEstrategiasDashboard() {
    const { data } = await supabase.from("strategies").select("*");
    if (data) setEstrategias(data as Strategy[]);
  }

  async function cargarTrades() {
    setCargandoTrades(true);
    setErrorCarga(null);

    const { data, error } = await supabase
      .from("trades")
      .select("*")
      .order("entry_time", { ascending: false });

    if (error) {
      setErrorCarga("No se pudieron cargar tus operaciones. Intenta de nuevo.");
    } else {
      setTrades(data as Trade[]);
    }
    setCargandoTrades(false);
  }

  async function cargarRetiros() {
    setCargandoRetiros(true);
    const { data } = await supabase
      .from("withdrawals")
      .select("*")
      .order("withdrawal_date", { ascending: false });
    setRetiros((data as Withdrawal[]) ?? []);
    setCargandoRetiros(false);
  }

  async function cargarLogros() {
    setCargandoLogros(true);
    const { data } = await supabase
      .from("achievements")
      .select("*")
      .order("achieved_date", { ascending: false });
    setLogros((data as Achievement[]) ?? []);
    setCargandoLogros(false);
  }

  async function cargarChecklist() {
    setCargandoChecklist(true);
    const { data: items } = await supabase
      .from("checklist_items")
      .select("*")
      .order("sort_order", { ascending: true });
    setChecklistItems((items as ChecklistItem[]) ?? []);

    const { data: logs } = await supabase
      .from("checklist_logs")
      .select("item_id")
      .eq("log_date", todayKey())
      .eq("completed", true);
    setChecklistCompletados(new Set((logs ?? []).map((l) => l.item_id as string)));
    setCargandoChecklist(false);
  }

  async function alternarItemChecklist(itemId: string) {
    const yaCompletado = checklistCompletados.has(itemId);

    if (yaCompletado) {
      await supabase.from("checklist_logs").delete().eq("item_id", itemId).eq("log_date", todayKey());
      setChecklistCompletados((prev) => {
        const nuevo = new Set(prev);
        nuevo.delete(itemId);
        return nuevo;
      });
    } else {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) return;
      await supabase
        .from("checklist_logs")
        .upsert(
          { user_id: userId, item_id: itemId, log_date: todayKey(), completed: true },
          { onConflict: "item_id,log_date" }
        );
      setChecklistCompletados((prev) => new Set(prev).add(itemId));
    }
  }

  async function agregarItemChecklist(texto: string) {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;
    await supabase
      .from("checklist_items")
      .insert({ user_id: userId, text: texto, sort_order: checklistItems.length });
    cargarChecklist();
  }

  async function eliminarItemChecklist(itemId: string) {
    await supabase.from("checklist_items").delete().eq("id", itemId);
    cargarChecklist();
  }

  useEffect(() => {
    cargarCuentas();
    cargarTrades();
    cargarEstrategiasDashboard();
    cargarRetiros();
    cargarLogros();
    cargarChecklist();
  }, []);

  const cuentaActiva =
    cuentaActivaId === "todas" ? null : cuentas.find((c) => c.id === cuentaActivaId) ?? null;
  const modoTodas = cuentaActivaId === "todas";

  // Retiros y ROI solo tienen sentido si hay al menos una cuenta real: en una
  // demo no hay plata de verdad para "retirar".
  const hayCuentaReal = cuentas.some((c) => c.account_type === "real");

  const navGruposFiltrados = useMemo(
    () =>
      NAV_GRUPOS.map((grupo) => ({
        ...grupo,
        items: grupo.items.filter(
          (item) => hayCuentaReal || (item.id !== "roi" && item.id !== "retiros" && item.id !== "logros")
        ),
      })).filter((grupo) => grupo.items.length > 0),
    [hayCuentaReal]
  );

  // Si la única cuenta real se elimina/archiva mientras estás viendo Retiros
  // o ROI, te manda de vuelta al Dashboard para no dejarte en una vista vacía.
  useEffect(() => {
    if (!hayCuentaReal && (vista === "roi" || vista === "retiros" || vista === "logros")) {
      setVista("inicio");
    }
  }, [hayCuentaReal, vista]);

  const tradesDeLaCuenta = useMemo(() => {
    if (cuentaActivaId === "todas") return trades;
    return trades.filter((t) => t.account_id === cuentaActivaId);
  }, [trades, cuentaActivaId]);

  const retirosDeLaCuenta = useMemo(() => {
    if (cuentaActivaId === "todas") return retiros;
    return retiros.filter((r) => r.account_id === cuentaActivaId);
  }, [retiros, cuentaActivaId]);

  const totalRetirado = useMemo(
    () => retirosDeLaCuenta.reduce((acc, r) => acc + r.amount, 0),
    [retirosDeLaCuenta]
  );

  // Total retirado por cuenta (para ROI de Cuentas y los chips)
  const retiradoPorCuenta = useMemo(() => {
    const mapa = new Map<string, number>();
    retiros.forEach((r) => {
      mapa.set(r.account_id, (mapa.get(r.account_id) ?? 0) + r.amount);
    });
    return mapa;
  }, [retiros]);

  // P&L por cuenta, para mostrar un mini-resumen en cada chip del selector
  const pnlPorCuenta = useMemo(() => {
    const mapa = new Map<string, number>();
    trades
      .filter((t) => t.status === "closed" && t.realized_pnl !== null && t.account_id)
      .forEach((t) => {
        const previo = mapa.get(t.account_id as string) ?? 0;
        mapa.set(t.account_id as string, previo + (t.realized_pnl ?? 0));
      });
    return mapa;
  }, [trades]);

  const metricas = useMemo(() => {
    const cerrados = tradesDeLaCuenta
      .filter((t) => t.status === "closed" && t.realized_pnl !== null)
      .sort((a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime());

    const totalPnL = cerrados.reduce((acc, t) => acc + (t.realized_pnl ?? 0), 0);
    const ganadores = cerrados.filter((t) => (t.realized_pnl ?? 0) > 0);
    const perdedores = cerrados.filter((t) => (t.realized_pnl ?? 0) < 0);
    const winRate = cerrados.length > 0 ? (ganadores.length / cerrados.length) * 100 : 0;

    const gananciaTotal = ganadores.reduce((acc, t) => acc + (t.realized_pnl ?? 0), 0);
    const perdidaTotal = Math.abs(perdedores.reduce((acc, t) => acc + (t.realized_pnl ?? 0), 0));
    const profitFactor = perdidaTotal > 0 ? gananciaTotal / perdidaTotal : null;

    const hoy = todayKey();
    const pnlHoy = cerrados
      .filter((t) => {
        const fecha = new Date(t.entry_time);
        const clave = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-${String(
          fecha.getDate()
        ).padStart(2, "0")}`;
        return clave === hoy;
      })
      .reduce((acc, t) => acc + (t.realized_pnl ?? 0), 0);

    // Racha actual: cuenta trades consecutivos (del más reciente hacia
    // atrás) con el mismo signo de resultado.
    let racha = 0;
    let tipoRacha: "ganadora" | "perdedora" | null = null;
    for (let i = cerrados.length - 1; i >= 0; i--) {
      const esGanadora = (cerrados[i].realized_pnl ?? 0) >= 0;
      if (tipoRacha === null) {
        tipoRacha = esGanadora ? "ganadora" : "perdedora";
        racha = 1;
      } else if ((tipoRacha === "ganadora") === esGanadora) {
        racha++;
      } else {
        break;
      }
    }

    // Promedios y extremos, para el nuevo panel de métricas tipo TradeLog
    const avgGanancia = ganadores.length > 0 ? gananciaTotal / ganadores.length : 0;
    const avgPerdida = perdedores.length > 0 ? perdidaTotal / perdedores.length : 0;
    const mejorTrade = cerrados.length > 0 ? Math.max(...cerrados.map((t) => t.realized_pnl ?? 0)) : 0;
    const peorTrade = cerrados.length > 0 ? Math.min(...cerrados.map((t) => t.realized_pnl ?? 0)) : 0;

    return {
      totalPnL,
      totalTrades: tradesDeLaCuenta.length,
      profitFactor,
      winRate,
      pnlHoy,
      racha,
      tipoRacha,
      ganadoresCount: ganadores.length,
      perdedoresCount: perdedores.length,
      avgGanancia,
      avgPerdida,
      mejorTrade,
      peorTrade,
    };
  }, [tradesDeLaCuenta]);

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  function irA(v: Vista) {
    setVista(v);
    setMenuMovilAbierto(false);
  }

  return (
    <div className="min-h-screen bg-kb-bg text-kb-text" suppressHydrationWarning>
      <div className="flex min-h-screen">
        {/* ---------- Sidebar (desktop) ---------- */}
        <aside className="hidden w-64 shrink-0 border-r border-kb-border-soft bg-kb-surface/40 lg:flex lg:flex-col">
          <div className="flex items-center gap-2.5 border-b border-kb-border-soft px-5 py-4">
            <div className="relative flex items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-kb-gain/20 blur-md" />
              <LogoKTrader size={28} />
            </div>
            <span className="font-display text-base font-bold tracking-tight">
              Kebo<span className="text-kb-gain">Trader</span>
            </span>
          </div>

          <SelectorCuentaSidebar
            cuentas={cuentas}
            cargando={cargandoCuentas}
            cuentaActivaId={cuentaActivaId}
            pnlPorCuenta={pnlPorCuenta}
            onSeleccionar={setCuentaActivaId}
            onNuevaCuenta={() => setMostrarModalCuenta(true)}
          />

          <nav className="flex-1 space-y-5 px-3 py-4">
            {navGruposFiltrados.map((grupo) => (
              <div key={grupo.titulo}>
                <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-kb-text-muted">
                  {grupo.titulo}
                </p>
                <div className="space-y-1">
                  {grupo.items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => irA(item.id)}
                      className={`relative flex w-full items-center justify-between gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        vista === item.id
                          ? "bg-kb-accent/10 text-kb-accent"
                          : "text-kb-text-secondary hover:bg-kb-surface hover:text-kb-text"
                      }`}
                    >
                      {vista === item.id && (
                        <span className="absolute -left-3 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-kb-accent" />
                      )}
                      <span className="flex items-center gap-2.5">
                        <span>{item.icono}</span>
                        {item.etiqueta}
                      </span>
                      <span className="text-[10px] text-kb-text-muted">{numeroDeItem(item.id)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          <div className="border-t border-kb-border-soft px-3 py-4">
            <div className="mb-3 flex items-center gap-2.5 px-1">
              <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-kb-accent/15 text-xs font-bold uppercase text-kb-accent">
                {(session.user.email ?? "?").slice(0, 1)}
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-kb-surface bg-kb-gain" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-kb-text">
                  {nombreDesdeEmail(session.user.email)}
                </p>
                <p className="truncate text-[10px] text-kb-text-muted">{session.user.email}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="w-full rounded-lg border border-kb-border px-3 py-2 text-xs font-medium text-kb-text-secondary hover:border-kb-loss hover:text-kb-loss transition-colors"
            >
              Cerrar sesión
            </button>
          </div>
        </aside>

        {/* ---------- Columna principal ---------- */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* ---------- Header móvil ---------- */}
          <header className="flex items-center justify-between border-b border-kb-border-soft px-4 py-3 lg:hidden">
            <div className="flex items-center gap-2">
              <LogoKTrader size={26} />
              <span className="font-display text-base font-bold tracking-tight">
                Kebo<span className="text-kb-gain">Trader</span>
              </span>
            </div>
            <button
              onClick={() => setMenuMovilAbierto((v) => !v)}
              aria-label="Abrir menú"
              className="rounded-lg border border-kb-border px-3 py-1.5 text-sm text-kb-text-secondary"
            >
              {NAV_ITEMS.find((i) => i.id === vista)?.icono} ☰
            </button>
          </header>
          {menuMovilAbierto && (
            <div className="grid grid-cols-3 gap-2 border-b border-kb-border-soft bg-kb-surface/40 p-3 lg:hidden">
              {navGruposFiltrados.flatMap((g) => g.items).map((item) => (
                <button
                  key={item.id}
                  onClick={() => irA(item.id)}
                  className={`rounded-lg px-2 py-2 text-center text-xs font-medium transition-colors ${
                    vista === item.id
                      ? "bg-kb-accent/10 text-kb-accent"
                      : "text-kb-text-secondary hover:bg-kb-surface"
                  }`}
                >
                  <span className="block text-base">{item.icono}</span>
                  {item.etiqueta}
                </button>
              ))}
              <button
                onClick={handleLogout}
                className="col-span-3 rounded-lg border border-kb-border px-3 py-2 text-xs font-medium text-kb-text-secondary"
              >
                Cerrar sesión
              </button>
            </div>
          )}

          {/* ---------- Selector de cuenta móvil (en desktop vive en el sidebar) ---------- */}
          <div className="border-b border-kb-border-soft bg-kb-surface/40 lg:hidden">
            <div className="flex items-center gap-3 overflow-x-auto px-4 py-3 lg:px-8">
              {cargandoCuentas ? (
                <>
                  <SkeletonBloque className="h-7 w-24 shrink-0" />
                  <SkeletonBloque className="h-7 w-20 shrink-0" />
                </>
              ) : cuentas.length === 0 ? (
                <span className="text-xs text-kb-text-secondary">
                  Todavía no tienes ninguna cuenta creada.
                </span>
              ) : (
                <>
                  <button
                    onClick={() => setCuentaActivaId("todas")}
                    className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      cuentaActivaId === "todas"
                        ? "border-kb-accent bg-kb-accent/10 text-kb-accent"
                        : "border-kb-border text-kb-text-secondary hover:border-kb-text-secondary"
                    }`}
                  >
                    📊 Todas las cuentas
                  </button>
                  {cuentas.map((c) => {
                    const pnlChip = pnlPorCuenta.get(c.id) ?? 0;
                    return (
                      <button
                        key={c.id}
                        onClick={() => setCuentaActivaId(c.id)}
                        className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                          c.id === cuentaActivaId
                            ? "border-kb-accent bg-kb-accent/10 text-kb-accent"
                            : "border-kb-border text-kb-text-secondary hover:border-kb-text-secondary"
                        }`}
                      >
                        <span
                          className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
                            c.account_type === "real" ? "bg-kb-loss" : "bg-kb-gain"
                          }`}
                        />
                        {c.name}
                        <span
                          className={`ml-2 font-mono ${
                            pnlChip >= 0 ? "text-kb-gain" : "text-kb-loss"
                          }`}
                        >
                          {pnlChip >= 0 ? "+" : ""}
                          {formatCurrency(pnlChip)}
                        </span>
                      </button>
                    );
                  })}
                </>
              )}
              <button
                onClick={() => setMostrarModalCuenta(true)}
                className="shrink-0 rounded-lg border border-dashed border-kb-border px-3 py-1.5 text-xs font-medium text-kb-text-secondary hover:border-kb-accent hover:text-kb-accent transition-colors"
              >
                + Nueva cuenta
              </button>
            </div>
          </div>

          {/* ---------- Contenido de la vista activa ---------- */}
          <div className="flex-1 px-4 py-6 lg:px-10 lg:py-8">
            <div className="mx-auto max-w-[1280px]">
            {vista === "inicio" && (
              <InicioView
                cuenta={cuentaActiva}
                trades={tradesDeLaCuenta}
                metricas={metricas}
                cuentas={cuentas}
                modoTodas={modoTodas}
                nombreUsuario={nombreDesdeEmail(session.user.email)}
                totalRetirado={totalRetirado}
                retiros={retirosDeLaCuenta}
                retiradoPorCuenta={retiradoPorCuenta}
                diaParaRegistrar={diaParaRegistrar}
                onSeleccionarDiaParaRegistrar={setDiaParaRegistrar}
                onIrARegistrar={() => irA("historial")}
                onIrACalendario={() => irA("calendario")}
                onIrARetiros={() => irA("retiros")}
                onIrARoi={() => irA("roi")}
                estrategias={estrategias}
                onTradeActualizado={cargarTrades}
                accountId={cuentaActivaId === "todas" ? null : cuentaActivaId}
                tieneCuentas={cuentas.length > 0}
                checklistItems={checklistItems}
                checklistCompletados={checklistCompletados}
                cargandoChecklist={cargandoChecklist}
                onToggleChecklist={alternarItemChecklist}
                onAgregarChecklistItem={agregarItemChecklist}
                onEliminarChecklistItem={eliminarItemChecklist}
              />
            )}

            {vista === "historial" && (
              <HistorialView
                trades={tradesDeLaCuenta}
                estrategias={estrategias}
                cargando={cargandoTrades}
                error={errorCarga}
                onTradeCreado={cargarTrades}
              />
            )}

            {vista === "calendario" && (
              <CalendarioRendimiento
                trades={tradesDeLaCuenta}
                estrategias={estrategias}
                accountId={cuentaActivaId === "todas" ? null : cuentaActivaId}
                tieneCuentas={cuentas.length > 0}
                diaSeleccionado={diaParaRegistrar}
                onSeleccionarDia={setDiaParaRegistrar}
                onTradeActualizado={cargarTrades}
              />
            )}

            {vista === "reportes" && <ReportesView trades={tradesDeLaCuenta} />}

            {vista === "estrategias" && (
              <EstrategiasView trades={tradesDeLaCuenta} estrategias={estrategias} onCambio={cargarEstrategiasDashboard} />
            )}

            {vista === "roi" && (
              <RoiCuentasView cuentas={cuentas} pnlPorCuenta={pnlPorCuenta} retiradoPorCuenta={retiradoPorCuenta} />
            )}

            {vista === "retiros" && (
              <RetirosView
                cuentas={cuentas}
                cuentaActivaId={cuentaActivaId}
                retiros={retirosDeLaCuenta}
                cargando={cargandoRetiros}
                onCambio={cargarRetiros}
              />
            )}

            {vista === "logros" && (
              <LogrosView
                cuentas={cuentas}
                cuentaActivaId={cuentaActivaId}
                logros={logros}
                cargando={cargandoLogros}
                onCambio={cargarLogros}
              />
            )}

            {vista === "perfil" && <PerfilView session={session} />}

            {vista === "configuracion" && (
              <ConfiguracionView
                cuentas={cuentas}
                onCambio={cargarCuentas}
                onVerArchivadas={() => setMostrarArchivadas(true)}
              />
            )}
            </div>
          </div>
        </div>
      </div>

      {mostrarModalCuenta && (
        <ModalNuevaCuenta
          onClose={() => setMostrarModalCuenta(false)}
          onCreada={(nuevaCuenta) => {
            setCuentas((prev) => [...prev, nuevaCuenta]);
            setCuentaActivaId(nuevaCuenta.id);
            setMostrarModalCuenta(false);
          }}
        />
      )}

      {mostrarArchivadas && (
        <ModalCuentasArchivadas
          onClose={() => setMostrarArchivadas(false)}
          onReactivada={(cuenta) => {
            setCuentas((prev) => [...prev, cuenta]);
            setCuentaActivaId(cuenta.id);
            setMostrarArchivadas(false);
          }}
        />
      )}
    </div>
  );
}

// =====================================================================
// VISTA: INICIO — snapshot compacto, no la página larga de antes
// =====================================================================

interface Metricas {
  totalPnL: number;
  totalTrades: number;
  profitFactor: number | null;
  winRate: number;
  pnlHoy: number;
  racha: number;
  tipoRacha: "ganadora" | "perdedora" | null;
  ganadoresCount: number;
  perdedoresCount: number;
  avgGanancia: number;
  avgPerdida: number;
  mejorTrade: number;
  peorTrade: number;
}

function InicioView({
  cuenta,
  trades,
  metricas,
  cuentas,
  modoTodas,
  nombreUsuario,
  totalRetirado,
  retiros,
  retiradoPorCuenta,
  diaParaRegistrar,
  onSeleccionarDiaParaRegistrar,
  onIrARegistrar,
  onIrACalendario,
  onIrARetiros,
  onIrARoi,
  estrategias,
  onTradeActualizado,
  accountId,
  tieneCuentas,
  checklistItems,
  checklistCompletados,
  cargandoChecklist,
  onToggleChecklist,
  onAgregarChecklistItem,
  onEliminarChecklistItem,
}: {
  cuenta: Account | null;
  trades: Trade[];
  metricas: Metricas;
  cuentas: Account[];
  modoTodas: boolean;
  nombreUsuario: string;
  totalRetirado: number;
  retiros: Withdrawal[];
  retiradoPorCuenta: Map<string, number>;
  diaParaRegistrar: string;
  onSeleccionarDiaParaRegistrar: (clave: string) => void;
  onIrARegistrar: () => void;
  onIrACalendario: () => void;
  onIrARetiros: () => void;
  onIrARoi: () => void;
  estrategias: Strategy[];
  onTradeActualizado: () => void;
  accountId: string | null;
  tieneCuentas: boolean;
  checklistItems: ChecklistItem[];
  checklistCompletados: Set<string>;
  cargandoChecklist: boolean;
  onToggleChecklist: (itemId: string) => void;
  onAgregarChecklistItem: (texto: string) => void;
  onEliminarChecklistItem: (itemId: string) => void;
}) {
  const balanceActual = cuenta ? cuenta.starting_balance + metricas.totalPnL - totalRetirado : 0;
  const progreso =
    cuenta && cuenta.starting_balance > 0 ? (metricas.totalPnL / cuenta.starting_balance) * 100 : 0;

  // Alerta de riesgo: solo tiene sentido asustar de verdad en cuentas reales.
  // En demo no hay plata en juego, así que no mostramos el banner de alarma.
  const perdidaDiariaActual = metricas.pnlHoy < 0 ? Math.abs(metricas.pnlHoy) : 0;
  const perdidaTotalActual = metricas.totalPnL < 0 ? Math.abs(metricas.totalPnL) : 0;
  const porcentajeDiario =
    cuenta?.max_daily_loss && cuenta.max_daily_loss > 0
      ? (perdidaDiariaActual / cuenta.max_daily_loss) * 100
      : 0;
  const porcentajeTotal =
    cuenta?.max_total_loss && cuenta.max_total_loss > 0
      ? (perdidaTotalActual / cuenta.max_total_loss) * 100
      : 0;
  const alertaRiesgo =
    cuenta?.account_type === "real" && (porcentajeDiario >= 80 || porcentajeTotal >= 80);

  const ultimasOperaciones = useMemo(
    () =>
      [...trades]
        .sort((a, b) => new Date(b.entry_time).getTime() - new Date(a.entry_time).getTime())
        .slice(0, 5),
    [trades]
  );

  const etiquetaRacha =
    metricas.racha === 0
      ? "—"
      : `${metricas.tipoRacha === "ganadora" ? "🔥" : "❄️"} ${metricas.racha} ${
          metricas.tipoRacha === "ganadora" ? "ganadoras" : "perdedoras"
        }`;

  // Invertido/retirado/ROI del alcance actual (cuenta específica o todas).
  // "Invertido" = lo que realmente pagaste (purchase_cost); si no lo
  // cargaste, se aproxima con el balance inicial.
  const invertido = cuenta
    ? cuenta.purchase_cost ?? cuenta.starting_balance
    : cuentas.reduce((acc, c) => acc + (c.purchase_cost ?? c.starting_balance), 0);
  const roiPorcentaje = invertido > 0 ? ((totalRetirado - invertido) / invertido) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* ---------- Saludo personalizado ---------- */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-kb-accent">Sesión activa</p>
        <h1 className="font-display text-xl font-bold text-kb-text">Hola, {nombreUsuario}</h1>
        <p className="text-xs text-kb-text-secondary">Resumen de tu rendimiento</p>
      </div>

      {/* ---------- Banner: cuenta individual ---------- */}
      {cuenta && (
        <>
          {alertaRiesgo && (
            <div className="flex items-center gap-2 rounded-xl border border-kb-loss/40 bg-kb-loss/10 px-4 py-2.5">
              <span className="text-base">⚠️</span>
              <p className="text-sm font-medium text-kb-loss">
                Estás usando{" "}
                {porcentajeDiario >= porcentajeTotal
                  ? `${porcentajeDiario.toFixed(0)}% de tu límite de pérdida diaria`
                  : `${porcentajeTotal.toFixed(0)}% de tu límite de pérdida total`}
                . Cuidado con seguir operando hoy.
              </p>
            </div>
          )}

          <section className="rounded-xl border border-kb-border bg-kb-surface p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h1 className="font-display text-base font-semibold">{cuenta.name}</h1>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    cuenta.account_type === "real"
                      ? "bg-kb-loss/10 text-kb-loss"
                      : "bg-kb-gain/10 text-kb-gain"
                  }`}
                >
                  {cuenta.account_type === "real" ? "Cuenta real" : "Demo"}
                </span>
                {cuenta.account_type === "demo" && (
                  <span className="rounded-full bg-kb-accent/10 px-2 py-0.5 text-[11px] font-medium text-kb-accent">
                    🎓 Modo aprendizaje
                  </span>
                )}
                {cuenta.phase !== "no_aplica" && (
                  <span className="rounded-full bg-kb-accent/10 px-2 py-0.5 text-[11px] font-medium text-kb-accent">
                    {PHASE_LABELS[cuenta.phase]}
                  </span>
                )}
              </div>
              <div className="text-right">
                <p className="text-[11px] leading-none text-kb-text-secondary">Balance actual</p>
                <p className="mt-0.5 font-mono text-lg font-semibold leading-tight">{formatCurrency(balanceActual)}</p>
                <p className={`font-mono text-[11px] ${progreso >= 0 ? "text-kb-gain" : "text-kb-loss"}`}>
                  {progreso >= 0 ? "+" : ""}
                  {progreso.toFixed(2)}% desde el inicio
                  {totalRetirado > 0 ? ` · ${formatCurrency(totalRetirado)} retirado` : ""}
                </p>
              </div>
            </div>

            {cuenta.account_type === "demo" && (
              <p className="mt-2 text-[11px] text-kb-text-secondary">
                Esta es una cuenta de práctica — usala para hacer backtesting y probar
                estrategias sin presión. Los límites de pérdida son solo de referencia.
              </p>
            )}

            {(cuenta.max_daily_loss || cuenta.max_total_loss) && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {cuenta.max_daily_loss && (
                  <BarraLimitePerdida
                    etiqueta="Pérdida diaria"
                    perdidaActual={perdidaDiariaActual}
                    limite={cuenta.max_daily_loss}
                  />
                )}
                {cuenta.max_total_loss && (
                  <BarraLimitePerdida
                    etiqueta="Pérdida total"
                    perdidaActual={perdidaTotalActual}
                    limite={cuenta.max_total_loss}
                  />
                )}
              </div>
            )}
          </section>
        </>
      )}

      {/* ---------- Banner: modo consolidado ("Todas las cuentas") ---------- */}
      {modoTodas && cuentas.length > 0 && (
        <section className="rounded-xl border border-kb-border bg-kb-surface p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-base font-semibold">📊 Todas las cuentas</h1>
              <p className="mt-0.5 text-[11px] text-kb-text-secondary">
                Vista combinada de {cuentas.length} cuenta{cuentas.length === 1 ? "" : "s"} activa
                {cuentas.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] leading-none text-kb-text-secondary">P&amp;L combinado</p>
              <p
                className={`mt-0.5 font-mono text-lg font-semibold leading-tight ${
                  metricas.totalPnL >= 0 ? "text-kb-gain" : "text-kb-loss"
                }`}
              >
                {formatCurrency(metricas.totalPnL)}
              </p>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-kb-text-muted">
            Para ver límites de pérdida y registrar operaciones, selecciona una cuenta
            específica arriba.
          </p>
        </section>
      )}

      {!cuenta && !modoTodas && cuentas.length === 0 && (
        <section className="rounded-xl border border-dashed border-kb-accent/40 bg-kb-accent/5 p-6">
          <div className="mx-auto max-w-md text-center">
            <p className="text-2xl">👋</p>
            <h2 className="mt-2 font-display text-lg font-semibold text-kb-text">
              ¡Bienvenido a KeboTrader!
            </h2>
            <p className="mt-1 text-sm text-kb-text-secondary">
              Te faltan 3 pasos rápidos para tener tu diario andando.
            </p>
          </div>

          <div className="mx-auto mt-5 max-w-md space-y-3 text-left">
            <div className="flex items-start gap-3 rounded-lg border border-kb-border-soft bg-kb-surface px-3 py-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-kb-accent/15 text-xs font-bold text-kb-accent">
                1
              </span>
              <div>
                <p className="text-sm font-medium text-kb-text">Creá tu primera cuenta</p>
                <p className="text-xs text-kb-text-secondary">
                  Usá el botón &quot;+ Nueva cuenta&quot; de arriba — puede ser demo o real.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-kb-border-soft bg-kb-surface px-3 py-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-kb-accent/15 text-xs font-bold text-kb-accent">
                2
              </span>
              <div>
                <p className="text-sm font-medium text-kb-text">Registrá tu primera operación</p>
                <p className="text-xs text-kb-text-secondary">
                  Andá al Calendario y hacé clic en un día para cargarla.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-kb-border-soft bg-kb-surface px-3 py-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-kb-accent/15 text-xs font-bold text-kb-accent">
                3
              </span>
              <div>
                <p className="text-sm font-medium text-kb-text">Explorá tus Reportes</p>
                <p className="text-xs text-kb-text-secondary">
                  Con un par de operaciones cargadas vas a empezar a ver patrones útiles.
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ---------- Checklist pre-trading del día ---------- */}
      <ChecklistDiarioWidget
        items={checklistItems}
        completados={checklistCompletados}
        cargando={cargandoChecklist}
        onToggle={onToggleChecklist}
        onAgregar={onAgregarChecklistItem}
        onEliminar={onEliminarChecklistItem}
      />

      {/* ---------- Panel de métricas principal (donut + barra + extremos) ---------- */}
      <PanelMetricasPrincipal metricas={metricas} etiquetaRacha={etiquetaRacha} />

      {/* ---------- Gráfico de P&L ---------- */}
      <GraficoPnL trades={trades} />

      {/* ---------- Fila: Calendario compacto + Trades recientes ---------- */}
      <section className="grid gap-4 lg:grid-cols-2">
        <MiniCalendario
          trades={trades}
          estrategias={estrategias}
          accountId={accountId}
          tieneCuentas={tieneCuentas}
          diaSeleccionado={diaParaRegistrar}
          onSeleccionarDia={onSeleccionarDiaParaRegistrar}
          onVerCompleto={onIrACalendario}
          onTradeActualizado={onTradeActualizado}
        />

        <section className="rounded-xl border border-kb-border bg-kb-surface">
          <div className="flex items-center justify-between border-b border-kb-border-soft px-4 py-2.5">
            <h2 className="font-display text-sm font-semibold">Trades recientes</h2>
            <button onClick={onIrARegistrar} className="text-xs font-medium text-kb-accent hover:underline">
              Ver todos →
            </button>
          </div>

          {ultimasOperaciones.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-kb-text-secondary">
              Todavía no registraste operaciones en esta cuenta.
            </p>
          ) : (
            <div className="divide-y divide-kb-border-soft">
              {ultimasOperaciones.map((t) => (
                <div key={t.id} className="flex items-center justify-between px-4 py-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        t.side === "long" ? "bg-kb-gain/10 text-kb-gain" : "bg-kb-loss/10 text-kb-loss"
                      }`}
                    >
                      {t.side === "long" ? "Long" : "Short"}
                    </span>
                    <span className="font-mono text-sm font-semibold">{t.symbol}</span>
                    <span className="text-[11px] text-kb-text-secondary">{formatDate(t.entry_time)}</span>
                    {t.emotion && (
                      <span className="text-xs" title={EMOTION_LABELS[t.emotion]}>
                        {EMOTION_EMOJI[t.emotion]}
                      </span>
                    )}
                  </div>
                  <span
                    className={`font-mono text-sm font-semibold ${
                      (t.realized_pnl ?? 0) >= 0 ? "text-kb-gain" : "text-kb-loss"
                    }`}
                  >
                    {t.realized_pnl === null ? "—" : formatCurrency(t.realized_pnl)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </section>

      {/* ---------- Fila: ROI de cuentas + Últimos retiros ---------- */}
      <section className="grid gap-4 lg:grid-cols-2">
        <RoiResumenPanel
          invertido={invertido}
          retirado={totalRetirado}
          roiPorcentaje={roiPorcentaje}
          onVerDetalle={onIrARoi}
        />

        <section className="rounded-xl border border-kb-border bg-kb-surface">
          <div className="flex items-center justify-between border-b border-kb-border-soft px-4 py-2.5">
            <h2 className="font-display text-sm font-semibold">Últimos retiros</h2>
            <button onClick={onIrARetiros} className="text-xs font-medium text-kb-accent hover:underline">
              Ver todos →
            </button>
          </div>

          {retiros.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-kb-text-secondary">
              Todavía no registraste retiros en esta cuenta.
            </p>
          ) : (
            <div className="divide-y divide-kb-border-soft">
              {retiros.slice(0, 5).map((r) => {
                const cuentaDelRetiro = cuentas.find((c) => c.id === r.account_id);
                return (
                  <div key={r.id} className="flex items-center justify-between px-4 py-2">
                    <div>
                      <p className="text-sm font-medium leading-tight">{cuentaDelRetiro?.name ?? "Cuenta eliminada"}</p>
                      <p className="text-[11px] text-kb-text-secondary">
                        {new Date(r.withdrawal_date + "T00:00:00").toLocaleDateString("es-ES", {
                          day: "2-digit",
                          month: "short",
                        })}
                      </p>
                    </div>
                    <span className="font-mono text-sm font-semibold text-kb-gain">
                      +{formatCurrency(r.amount)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </section>
    </div>
  );
}

// =====================================================================
// MINI CALENDARIO — versión compacta para el Dashboard, con link a la
// vista Calendario completa
// =====================================================================

function MiniCalendario({
  trades,
  estrategias,
  diaSeleccionado,
  onSeleccionarDia,
  onVerCompleto,
  onTradeActualizado,
  accountId,
  tieneCuentas,
}: {
  trades: Trade[];
  estrategias: Strategy[];
  diaSeleccionado: string;
  onSeleccionarDia: (clave: string) => void;
  onVerCompleto: () => void;
  onTradeActualizado: () => void;
  accountId: string | null;
  tieneCuentas: boolean;
}) {
  const [mesActual, setMesActual] = useState(() => {
    const hoy = new Date();
    return { year: hoy.getFullYear(), month: hoy.getMonth() };
  });
  const [diaConVarios, setDiaConVarios] = useState<{ clave: string; trades: Trade[] } | null>(null);
  const [tradeSeleccionado, setTradeSeleccionado] = useState<Trade | null>(null);
  const [diaParaCrear, setDiaParaCrear] = useState<string | null>(null);

  const resumenPorDia = useMemo(() => {
    const mapa = new Map<string, number>();
    trades
      .filter((t) => t.status === "closed" && t.realized_pnl !== null)
      .forEach((t) => {
        const clave = t.entry_time.slice(0, 10);
        mapa.set(clave, (mapa.get(clave) ?? 0) + (t.realized_pnl ?? 0));
      });
    return mapa;
  }, [trades]);

  const diasConPendiente = useMemo(() => {
    const set = new Set<string>();
    trades.filter((t) => t.status === "open").forEach((t) => set.add(t.entry_time.slice(0, 10)));
    return set;
  }, [trades]);

  const celdas = useMemo(() => {
    const { year, month } = mesActual;
    const primerDia = new Date(year, month, 1);
    const ultimoDia = new Date(year, month + 1, 0);
    const offsetInicial = (primerDia.getDay() + 6) % 7;

    const dias: Array<{ fecha: Date; clave: string } | null> = [];
    for (let i = 0; i < offsetInicial; i++) dias.push(null);
    for (let d = 1; d <= ultimoDia.getDate(); d++) {
      const fecha = new Date(year, month, d);
      const clave = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      dias.push({ fecha, clave });
    }
    return dias;
  }, [mesActual]);

  function cambiarMes(delta: number) {
    setMesActual((prev) => {
      const nuevaFecha = new Date(prev.year, prev.month + delta, 1);
      return { year: nuevaFecha.getFullYear(), month: nuevaFecha.getMonth() };
    });
  }

  function manejarClickDia(clave: string) {
    // Incluye tanto operaciones cerradas como pendientes de ese día, para
    // poder finalizar una pendiente con un clic desde el calendario.
    const tradesDelDia = trades.filter((t) => t.entry_time.slice(0, 10) === clave);
    if (tradesDelDia.length === 0) {
      onSeleccionarDia(clave);
      setDiaParaCrear(clave);
    } else {
      setDiaConVarios({ clave, trades: tradesDelDia });
    }
  }

  return (
    <section className="rounded-xl border border-kb-border bg-kb-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-sm font-semibold">
            {MESES[mesActual.month]} {mesActual.year}
          </h2>
          <button onClick={() => cambiarMes(-1)} className="rounded-md border border-kb-border px-1.5 py-0.5 text-xs text-kb-text-secondary hover:border-kb-accent hover:text-kb-accent transition-colors">‹</button>
          <button onClick={() => cambiarMes(1)} className="rounded-md border border-kb-border px-1.5 py-0.5 text-xs text-kb-text-secondary hover:border-kb-accent hover:text-kb-accent transition-colors">›</button>
        </div>
        <button onClick={onVerCompleto} className="rounded-lg border border-kb-accent/40 px-2 py-1 text-xs font-medium text-kb-accent hover:bg-kb-accent/10 transition-colors">
          Ver completo →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[9px] text-kb-text-muted mb-1">
        {DIAS_SEMANA.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {celdas.map((celda, i) => {
          if (!celda) return <div key={`vacio-${i}`} />;
          const pnl = resumenPorDia.get(celda.clave);
          const tienePendiente = diasConPendiente.has(celda.clave);
          const esHoy = celda.clave === todayKey();
          const seleccionado = diaSeleccionado === celda.clave;

          let estiloCelda = "border-kb-border-soft bg-kb-bg text-kb-text-secondary";
          if (pnl !== undefined) {
            estiloCelda =
              pnl >= 0
                ? "border-kb-gain/30 bg-kb-gain/10 text-kb-gain"
                : "border-kb-loss/30 bg-kb-loss/10 text-kb-loss";
          } else if (tienePendiente) {
            estiloCelda = "border-kb-accent/40 bg-kb-accent/10 text-kb-accent";
          }

          return (
            <button
              key={celda.clave}
              type="button"
              onClick={() => manejarClickDia(celda.clave)}
              className={`relative h-10 rounded-md border p-1 text-left transition-colors hover:brightness-125 ${estiloCelda} ${
                seleccionado ? "ring-2 ring-kb-accent" : ""
              } ${esHoy ? "outline outline-1 outline-kb-accent/50" : ""}`}
            >
              {tienePendiente && <span className="absolute right-0.5 top-0.5 text-[9px]">🕐</span>}
              <span className="block text-[10px] font-medium">{celda.fecha.getDate()}</span>
              {pnl !== undefined && (
                <span className="block font-mono text-[9px] font-semibold leading-tight">
                  {pnl >= 0 ? "+" : ""}
                  {formatCurrency(pnl)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {diaConVarios && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-kb-border bg-kb-surface p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">
                {new Date(diaConVarios.clave + "T00:00:00").toLocaleDateString("es-ES", {
                  day: "numeric",
                  month: "long",
                })}
              </h3>
              <button
                onClick={() => setDiaConVarios(null)}
                className="text-kb-text-muted hover:text-kb-text transition"
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>
            <p className="mb-3 text-xs text-kb-text-secondary">
              Este día tenés {diaConVarios.trades.length} operación{diaConVarios.trades.length === 1 ? "" : "es"} registrada{diaConVarios.trades.length === 1 ? "" : "s"}.
            </p>
            <div className="space-y-2">
              {diaConVarios.trades.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setTradeSeleccionado(t);
                    setDiaConVarios(null);
                  }}
                  className="flex w-full items-center justify-between rounded-lg border border-kb-border-soft bg-kb-bg px-3 py-2.5 text-left hover:border-kb-accent transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        t.side === "long" ? "bg-kb-gain/10 text-kb-gain" : "bg-kb-loss/10 text-kb-loss"
                      }`}
                    >
                      {t.side === "long" ? "Long" : "Short"}
                    </span>
                    <span className="font-mono text-sm font-semibold">{t.symbol}</span>
                  </span>
                  <span
                    className={`font-mono text-sm font-semibold ${
                      (t.realized_pnl ?? 0) >= 0 ? "text-kb-gain" : "text-kb-loss"
                    }`}
                  >
                    {t.realized_pnl === null ? "—" : formatCurrency(t.realized_pnl)}
                  </span>
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                setDiaParaCrear(diaConVarios.clave);
                setDiaConVarios(null);
              }}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-kb-accent/40 px-3 py-2.5 text-sm font-medium text-kb-accent hover:bg-kb-accent/10 transition-colors"
            >
              + Agregar otra operación
            </button>
          </div>
        </div>
      )}

      {tradeSeleccionado && (
        <ModalDetalleTrade
          trade={tradeSeleccionado}
          estrategias={estrategias}
          onClose={() => setTradeSeleccionado(null)}
          onActualizado={() => {
            setTradeSeleccionado(null);
            onTradeActualizado();
          }}
          onEliminado={() => {
            setTradeSeleccionado(null);
            onTradeActualizado();
          }}
        />
      )}

      {diaParaCrear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 overflow-y-auto">
          <div className="w-full max-h-[85vh] max-w-2xl overflow-y-auto rounded-2xl border border-kb-border bg-kb-surface p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">
                Registrar operación —{" "}
                {new Date(diaParaCrear + "T00:00:00").toLocaleDateString("es-ES", {
                  day: "numeric",
                  month: "long",
                })}
              </h3>
              <button
                onClick={() => setDiaParaCrear(null)}
                className="text-kb-text-muted hover:text-kb-text transition"
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>
            <FormularioTrade
              accountId={accountId}
              tieneCuentas={tieneCuentas}
              diaParaRegistrar={diaParaCrear}
              estrategiasDisponibles={estrategias}
              onTradeCreado={() => {
                setDiaParaCrear(null);
                onTradeActualizado();
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}

// =====================================================================
// PANEL RESUMEN DE ROI (usado en Dashboard, con link al detalle)
// =====================================================================

function RoiResumenPanel({
  invertido,
  retirado,
  roiPorcentaje,
  onVerDetalle,
}: {
  invertido: number;
  retirado: number;
  roiPorcentaje: number;
  onVerDetalle: () => void;
}) {
  const maxBarra = Math.max(invertido, retirado, 1);

  return (
    <section className="rounded-xl border border-kb-border bg-kb-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold">ROI de Cuentas</h2>
        <button onClick={onVerDetalle} className="text-xs font-medium text-kb-accent hover:underline">
          Ver detalle →
        </button>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2">
        <div>
          <p className="text-[10px] uppercase leading-none tracking-wide text-kb-text-secondary">Invertido</p>
          <p className="mt-0.5 font-mono text-base font-semibold leading-tight text-kb-text">{formatCurrency(invertido)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase leading-none tracking-wide text-kb-text-secondary">Retirado</p>
          <p className="mt-0.5 font-mono text-base font-semibold leading-tight text-kb-gain">{formatCurrency(retirado)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase leading-none tracking-wide text-kb-text-secondary">ROI</p>
          <p className={`mt-0.5 font-mono text-base font-semibold leading-tight ${roiPorcentaje >= 0 ? "text-kb-gain" : "text-kb-loss"}`}>
            {roiPorcentaje.toFixed(2)}%
          </p>
        </div>
      </div>

      <div className="flex h-20 items-end gap-5 px-3">
        <div className="flex flex-1 flex-col items-center gap-1">
          <div
            className="w-full max-w-12 rounded-t-md bg-kb-loss"
            style={{ height: `${Math.max((invertido / maxBarra) * 100, 4)}%` }}
          />
          <span className="text-[10px] text-kb-text-secondary">Invertido</span>
        </div>
        <div className="flex flex-1 flex-col items-center gap-1">
          <div
            className="w-full max-w-12 rounded-t-md bg-kb-gain"
            style={{ height: `${Math.max((retirado / maxBarra) * 100, 4)}%` }}
          />
          <span className="text-[10px] text-kb-text-secondary">Retirado</span>
        </div>
      </div>
    </section>
  );
}

// =====================================================================
// VISTA: HISTORIAL — filtros + tabla + formulario de registro
// =====================================================================

interface Filtros {
  estrategiaId: string;
  sesion: TradingSession | "";
  resultado: ResultType | "";
}

function HistorialView({
  trades,
  estrategias,
  cargando,
  error,
  onTradeCreado,
}: {
  trades: Trade[];
  estrategias: Strategy[];
  cargando: boolean;
  error: string | null;
  onTradeCreado: () => void;
}) {
  const [filtros, setFiltros] = useState<Filtros>({ estrategiaId: "", sesion: "", resultado: "" });
  const [busqueda, setBusqueda] = useState("");
  const [tradeSeleccionado, setTradeSeleccionado] = useState<Trade | null>(null);

  const tradesFiltrados = useMemo(() => {
    const busquedaNormalizada = busqueda.trim().toUpperCase();
    return trades.filter((t) => {
      if (filtros.estrategiaId && t.strategy_id !== filtros.estrategiaId) return false;
      if (filtros.sesion && t.session !== filtros.sesion) return false;
      if (filtros.resultado && t.result_type !== filtros.resultado) return false;
      if (busquedaNormalizada && !t.symbol.toUpperCase().includes(busquedaNormalizada)) return false;
      return true;
    });
  }, [trades, filtros, busqueda]);

  const hayFiltrosActivos =
    filtros.estrategiaId !== "" || filtros.sesion !== "" || filtros.resultado !== "" || busqueda !== "";

  return (
    <div className="space-y-6">
      <section className="flex items-center gap-2 rounded-xl border border-dashed border-kb-border bg-kb-surface px-4 py-3">
        <span className="text-base">📅</span>
        <p className="text-sm text-kb-text-secondary">
          Para registrar una nueva operación, hacé clic en el día correspondiente desde el{" "}
          <span className="font-medium text-kb-accent">Calendario</span> (en el Dashboard o en
          la sección Calendario del menú). Acá solo vas a ver tu historial.
        </p>
      </section>

      <section className="rounded-xl border border-kb-border bg-kb-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-kb-border-soft px-5 py-4">
          <h2 className="font-display text-lg font-semibold">Historial de operaciones</h2>

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar símbolo…"
              className={`${filtroSelectClass} w-32`}
            />

            <select
              value={filtros.estrategiaId}
              onChange={(e) => setFiltros((f) => ({ ...f, estrategiaId: e.target.value }))}
              className={filtroSelectClass}
            >
              <option value="">Todas las estrategias</option>
              {estrategias.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>

            <select
              value={filtros.sesion}
              onChange={(e) =>
                setFiltros((f) => ({ ...f, sesion: e.target.value as TradingSession | "" }))
              }
              className={filtroSelectClass}
            >
              <option value="">Todas las sesiones</option>
              {Object.entries(SESSION_LABELS).map(([valor, etiqueta]) => (
                <option key={valor} value={valor}>
                  {etiqueta}
                </option>
              ))}
            </select>

            <select
              value={filtros.resultado}
              onChange={(e) =>
                setFiltros((f) => ({ ...f, resultado: e.target.value as ResultType | "" }))
              }
              className={filtroSelectClass}
            >
              <option value="">Todos los resultados</option>
              {Object.entries(RESULT_LABELS).map(([valor, etiqueta]) => (
                <option key={valor} value={valor}>
                  {etiqueta}
                </option>
              ))}
            </select>

            {hayFiltrosActivos && (
              <button
                onClick={() => {
                  setFiltros({ estrategiaId: "", sesion: "", resultado: "" });
                  setBusqueda("");
                }}
                className="rounded-lg border border-kb-border px-2.5 py-1.5 text-xs text-kb-text-secondary hover:text-kb-text transition-colors"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        </div>

        {cargando ? (
          <SkeletonTabla filas={6} columnas={8} />
        ) : error ? (
          <p className="px-5 py-10 text-center text-sm text-kb-loss">{error}</p>
        ) : tradesFiltrados.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-kb-text-secondary">
            {hayFiltrosActivos
              ? "Ninguna operación coincide con estos filtros."
              : "Todavía no registraste ninguna operación en esta cuenta. Hacé clic en un día del Calendario para registrar la primera."}
          </p>
        ) : (
          <>
            <p className="px-5 pt-3 text-xs text-kb-text-muted">
              {tradesFiltrados.length} de {trades.length} operaciones · haz clic en una fila para
              ver el detalle, editar o eliminar
            </p>
            <TablaTrades trades={tradesFiltrados} onSeleccionarTrade={setTradeSeleccionado} />
          </>
        )}
      </section>

      {tradeSeleccionado && (
        <ModalDetalleTrade
          trade={tradeSeleccionado}
          estrategias={estrategias}
          onClose={() => setTradeSeleccionado(null)}
          onActualizado={() => {
            setTradeSeleccionado(null);
            onTradeCreado();
          }}
          onEliminado={() => {
            setTradeSeleccionado(null);
            onTradeCreado();
          }}
        />
      )}
    </div>
  );
}

const filtroSelectClass =
  "rounded-lg border border-kb-border bg-kb-bg px-2.5 py-1.5 text-xs text-kb-text outline-none focus:border-kb-accent";

// =====================================================================
// VISTA: ESTRATEGIAS
// =====================================================================

function EstrategiasView({
  trades,
  estrategias,
  onCambio,
}: {
  trades: Trade[];
  estrategias: Strategy[];
  onCambio: () => void;
}) {
  const [nombreNueva, setNombreNueva] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function crear(e: FormEvent) {
    e.preventDefault();
    const nombre = nombreNueva.trim();
    if (!nombre) return;

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;

    setGuardando(true);
    await supabase.from("strategies").insert({ user_id: userId, name: nombre });
    setGuardando(false);
    setNombreNueva("");
    onCambio();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-kb-border bg-kb-surface p-5">
        <h2 className="font-display text-lg font-semibold mb-3">Nueva estrategia</h2>
        <form onSubmit={crear} className="flex gap-2">
          <input
            value={nombreNueva}
            onChange={(e) => setNombreNueva(e.target.value)}
            placeholder="Ej. Breakout, Soporte/Resistencia…"
            className={inputClass}
          />
          <button
            type="submit"
            disabled={guardando}
            className="shrink-0 rounded-lg bg-kb-accent px-4 text-sm font-medium text-kb-bg hover:brightness-110 transition disabled:opacity-60"
          >
            {guardando ? "Creando…" : "Crear"}
          </button>
        </form>
      </section>

      <GestionReglasEstrategias estrategias={estrategias} onCambio={onCambio} />

      <ResumenPorEstrategia trades={trades} estrategias={estrategias} />
    </div>
  );
}

// =====================================================================
// GESTIÓN DE REGLAS (CHECKLIST) POR ESTRATEGIA
// =====================================================================

function GestionReglasEstrategias({
  estrategias,
  onCambio,
}: {
  estrategias: Strategy[];
  onCambio: () => void;
}) {
  const [expandidaId, setExpandidaId] = useState<string | null>(null);

  return (
    <section className="rounded-xl border border-kb-border bg-kb-surface">
      <div className="border-b border-kb-border-soft px-5 py-4">
        <h2 className="font-display text-lg font-semibold">Reglas por estrategia</h2>
        <p className="text-xs text-kb-text-secondary">
          Definí un checklist para cada estrategia y validalo antes de entrar a una operación.
        </p>
      </div>

      {estrategias.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-kb-text-secondary">
          Creá una estrategia arriba para poder agregarle reglas.
        </p>
      ) : (
        <div className="divide-y divide-kb-border-soft">
          {estrategias.map((est) => (
            <FilaEstrategiaConReglas
              key={est.id}
              estrategia={est}
              expandida={expandidaId === est.id}
              onToggle={() => setExpandidaId(expandidaId === est.id ? null : est.id)}
              onCambio={onCambio}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function FilaEstrategiaConReglas({
  estrategia,
  expandida,
  onToggle,
  onCambio,
}: {
  estrategia: Strategy;
  expandida: boolean;
  onToggle: () => void;
  onCambio: () => void;
}) {
  const [nuevaRegla, setNuevaRegla] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function agregarRegla(e: FormEvent) {
    e.preventDefault();
    const texto = nuevaRegla.trim();
    if (!texto) return;

    setGuardando(true);
    await supabase
      .from("strategies")
      .update({ rules: [...estrategia.rules, texto] })
      .eq("id", estrategia.id);
    setGuardando(false);
    setNuevaRegla("");
    onCambio();
  }

  async function eliminarRegla(indice: number) {
    const nuevasReglas = estrategia.rules.filter((_, i) => i !== indice);
    await supabase.from("strategies").update({ rules: nuevasReglas }).eq("id", estrategia.id);
    onCambio();
  }

  return (
    <div>
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-5 py-3.5 text-left hover:bg-kb-bg/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{estrategia.name}</span>
          <span className="rounded-full bg-kb-border px-2 py-0.5 text-[11px] text-kb-text-secondary">
            {estrategia.rules.length} regla{estrategia.rules.length === 1 ? "" : "s"}
          </span>
        </div>
        <span className={`text-kb-text-muted transition-transform ${expandida ? "rotate-180" : ""}`}>⌄</span>
      </button>

      {expandida && (
        <div className="px-5 pb-4">
          {estrategia.rules.length === 0 ? (
            <p className="mb-3 text-xs text-kb-text-secondary">
              Todavía no tiene reglas. Agregá la primera abajo.
            </p>
          ) : (
            <ul className="mb-3 space-y-1.5">
              {estrategia.rules.map((regla, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between rounded-lg border border-kb-border-soft bg-kb-bg px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-kb-accent">☑</span>
                    {regla}
                  </span>
                  <button
                    onClick={() => eliminarRegla(i)}
                    className="text-xs text-kb-text-muted hover:text-kb-loss transition-colors"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={agregarRegla} className="flex gap-2">
            <input
              value={nuevaRegla}
              onChange={(e) => setNuevaRegla(e.target.value)}
              placeholder="Ej. ¿Hay confirmación de volumen?"
              className={inputClass}
            />
            <button
              type="submit"
              disabled={guardando}
              className="shrink-0 rounded-lg border border-kb-accent/40 px-3 text-sm font-medium text-kb-accent hover:bg-kb-accent/10 transition-colors disabled:opacity-60"
            >
              + Agregar
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
// VISTA: REPORTES — insights automáticos a partir de los datos que ya
// se registran (sesión, día, emoción, error, rachas y drawdown)
// =====================================================================

const DIAS_SEMANA_LARGO = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function ReportesView({ trades }: { trades: Trade[] }) {
  const cerrados = useMemo(
    () =>
      trades
        .filter((t) => t.status === "closed" && t.realized_pnl !== null)
        .sort((a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime()),
    [trades]
  );

  // ---- Mejor / peor día ----
  const porDia = useMemo(() => {
    const mapa = new Map<string, number>();
    cerrados.forEach((t) => {
      const clave = t.entry_time.slice(0, 10);
      mapa.set(clave, (mapa.get(clave) ?? 0) + (t.realized_pnl ?? 0));
    });
    const entradas = Array.from(mapa.entries());
    const mejor = entradas.reduce((a, b) => (b[1] > a[1] ? b : a), entradas[0] ?? null);
    const peor = entradas.reduce((a, b) => (b[1] < a[1] ? b : a), entradas[0] ?? null);
    return { mejor, peor };
  }, [cerrados]);

  // ---- Racha más larga (ganadora y perdedora) ----
  const rachas = useMemo(() => {
    let maxGanadora = 0;
    let maxPerdedora = 0;
    let actual = 0;
    let tipoActual: "g" | "p" | null = null;

    cerrados.forEach((t) => {
      const esGanadora = (t.realized_pnl ?? 0) >= 0;
      const tipo = esGanadora ? "g" : "p";
      if (tipo === tipoActual) {
        actual++;
      } else {
        tipoActual = tipo;
        actual = 1;
      }
      if (tipo === "g") maxGanadora = Math.max(maxGanadora, actual);
      else maxPerdedora = Math.max(maxPerdedora, actual);
    });

    return { maxGanadora, maxPerdedora };
  }, [cerrados]);

  // ---- Drawdown máximo (sobre la curva de equity acumulada) ----
  const drawdownMaximo = useMemo(() => {
    let acumulado = 0;
    let pico = 0;
    let peorCaida = 0;
    cerrados.forEach((t) => {
      acumulado += t.realized_pnl ?? 0;
      pico = Math.max(pico, acumulado);
      peorCaida = Math.max(peorCaida, pico - acumulado);
    });
    return peorCaida;
  }, [cerrados]);

  // ---- Rendimiento por sesión ----
  const porSesion = useMemo(() => {
    const grupos = new Map<TradingSession, { pnl: number; total: number; ganadores: number }>();
    cerrados.forEach((t) => {
      if (!t.session) return;
      const actual = grupos.get(t.session) ?? { pnl: 0, total: 0, ganadores: 0 };
      actual.pnl += t.realized_pnl ?? 0;
      actual.total += 1;
      if ((t.realized_pnl ?? 0) > 0) actual.ganadores += 1;
      grupos.set(t.session, actual);
    });
    return Array.from(grupos.entries())
      .map(([sesion, d]) => ({ etiqueta: SESSION_LABELS[sesion], ...d, winRate: (d.ganadores / d.total) * 100 }))
      .sort((a, b) => b.pnl - a.pnl);
  }, [cerrados]);

  // ---- Rendimiento por día de la semana ----
  const porDiaSemana = useMemo(() => {
    const grupos = new Map<number, { pnl: number; total: number; ganadores: number }>();
    cerrados.forEach((t) => {
      const dia = new Date(t.entry_time).getDay();
      const actual = grupos.get(dia) ?? { pnl: 0, total: 0, ganadores: 0 };
      actual.pnl += t.realized_pnl ?? 0;
      actual.total += 1;
      if ((t.realized_pnl ?? 0) > 0) actual.ganadores += 1;
      grupos.set(dia, actual);
    });
    return Array.from(grupos.entries())
      .map(([dia, d]) => ({ etiqueta: DIAS_SEMANA_LARGO[dia], ...d, winRate: (d.ganadores / d.total) * 100 }))
      .sort((a, b) => b.pnl - a.pnl);
  }, [cerrados]);

  // ---- Rendimiento por emoción ----
  const porEmocion = useMemo(() => {
    const grupos = new Map<EmotionType, { pnl: number; total: number; ganadores: number }>();
    cerrados.forEach((t) => {
      if (!t.emotion) return;
      const actual = grupos.get(t.emotion) ?? { pnl: 0, total: 0, ganadores: 0 };
      actual.pnl += t.realized_pnl ?? 0;
      actual.total += 1;
      if ((t.realized_pnl ?? 0) > 0) actual.ganadores += 1;
      grupos.set(t.emotion, actual);
    });
    return Array.from(grupos.entries())
      .map(([emocion, d]) => ({
        etiqueta: `${EMOTION_EMOJI[emocion]} ${EMOTION_LABELS[emocion]}`,
        ...d,
        winRate: (d.ganadores / d.total) * 100,
      }))
      .sort((a, b) => b.pnl - a.pnl);
  }, [cerrados]);

  // ---- Error más frecuente y su costo ----
  const porError = useMemo(() => {
    const grupos = new Map<MistakeType, { pnl: number; total: number }>();
    cerrados.forEach((t) => {
      if (!t.mistake || t.mistake === "ninguno") return;
      const actual = grupos.get(t.mistake) ?? { pnl: 0, total: 0 };
      actual.pnl += t.realized_pnl ?? 0;
      actual.total += 1;
      grupos.set(t.mistake, actual);
    });
    return Array.from(grupos.entries())
      .map(([error, d]) => ({ etiqueta: MISTAKE_LABELS[error], ...d }))
      .sort((a, b) => b.total - a.total);
  }, [cerrados]);

  if (cerrados.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-kb-border bg-kb-surface p-8 text-center">
        <p className="text-sm text-kb-text-secondary">
          Cierra algunas operaciones para desbloquear tus reportes automáticos aquí.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ---------- Tarjetas resumen ---------- */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          etiqueta="Mejor día"
          valor={porDia.mejor ? formatCurrency(porDia.mejor[1]) : "—"}
          tono={porDia.mejor ? (porDia.mejor[1] >= 0 ? "gain" : "loss") : undefined}
        />
        <MetricCard
          etiqueta="Peor día"
          valor={porDia.peor ? formatCurrency(porDia.peor[1]) : "—"}
          tono={porDia.peor ? (porDia.peor[1] >= 0 ? "gain" : "loss") : undefined}
        />
        <MetricCard
          etiqueta="Racha ganadora más larga"
          valor={`🔥 ${rachas.maxGanadora}`}
          tono="gain"
        />
        <MetricCard
          etiqueta="Drawdown máximo"
          valor={formatCurrency(drawdownMaximo)}
          tono={drawdownMaximo > 0 ? "loss" : undefined}
        />
      </section>

      {/* ---------- Rendimiento por sesión ---------- */}
      <ReporteBarras
        titulo="Rendimiento por sesión"
        subtitulo="¿En qué sesión de mercado rindes mejor?"
        filas={porSesion}
      />

      {/* ---------- Rendimiento por día de la semana ---------- */}
      <ReporteBarras
        titulo="Rendimiento por día de la semana"
        subtitulo="¿Hay algún día que te conviene evitar?"
        filas={porDiaSemana}
      />

      {/* ---------- Rendimiento por emoción ---------- */}
      <ReporteBarras
        titulo="Rendimiento por emoción"
        subtitulo="¿Con qué estado emocional operas mejor?"
        filas={porEmocion}
        vacio="Todavía no registraste la emoción en ninguna operación."
      />

      {/* ---------- Errores más frecuentes ---------- */}
      <section className="rounded-xl border border-kb-border bg-kb-surface">
        <div className="border-b border-kb-border-soft px-5 py-4">
          <h2 className="font-display text-lg font-semibold">Errores más frecuentes</h2>
          <p className="text-xs text-kb-text-secondary">Cuánto te costó cada patrón de error</p>
        </div>
        {porError.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-kb-text-secondary">
            Sin errores registrados todavía — ¡buena señal!
          </p>
        ) : (
          <div className="divide-y divide-kb-border-soft">
            {porError.map((f) => (
              <div key={f.etiqueta} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium">{f.etiqueta}</p>
                  <p className="text-xs text-kb-text-secondary">
                    {f.total} operacion{f.total === 1 ? "" : "es"}
                  </p>
                </div>
                <span
                  className={`font-mono text-sm font-semibold ${
                    f.pnl >= 0 ? "text-kb-gain" : "text-kb-loss"
                  }`}
                >
                  {formatCurrency(f.pnl)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

interface FilaReporte {
  etiqueta: string;
  pnl: number;
  total: number;
  winRate: number;
}

function ReporteBarras({
  titulo,
  subtitulo,
  filas,
  vacio,
}: {
  titulo: string;
  subtitulo: string;
  filas: FilaReporte[];
  vacio?: string;
}) {
  const maxAbs = Math.max(...filas.map((f) => Math.abs(f.pnl)), 1);

  return (
    <section className="rounded-xl border border-kb-border bg-kb-surface">
      <div className="border-b border-kb-border-soft px-5 py-4">
        <h2 className="font-display text-lg font-semibold">{titulo}</h2>
        <p className="text-xs text-kb-text-secondary">{subtitulo}</p>
      </div>

      {filas.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-kb-text-secondary">
          {vacio ?? "Todavía no hay suficientes datos para este reporte."}
        </p>
      ) : (
        <div className="space-y-3 px-5 py-4">
          {filas.map((f) => (
            <div key={f.etiqueta}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-kb-text">{f.etiqueta}</span>
                <span className="flex items-center gap-2 text-kb-text-secondary">
                  <span className={f.winRate >= 50 ? "text-kb-gain" : "text-kb-loss"}>
                    {f.winRate.toFixed(0)}% WR
                  </span>
                  <span className="text-kb-text-muted">·</span>
                  <span>{f.total} ops</span>
                  <span
                    className={`font-mono font-semibold ${
                      f.pnl >= 0 ? "text-kb-gain" : "text-kb-loss"
                    }`}
                  >
                    {formatCurrency(f.pnl)}
                  </span>
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-kb-border">
                <div
                  className={`h-full rounded-full ${f.pnl >= 0 ? "bg-kb-gain" : "bg-kb-loss"}`}
                  style={{ width: `${(Math.abs(f.pnl) / maxAbs) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// =====================================================================
// VISTA: PERFIL
// =====================================================================

// =====================================================================
// VISTA: ROI DE CUENTAS — comparación completa de invertido/retirado/ROI
// por cada cuenta
// =====================================================================

function RoiCuentasView({
  cuentas,
  pnlPorCuenta,
  retiradoPorCuenta,
}: {
  cuentas: Account[];
  pnlPorCuenta: Map<string, number>;
  retiradoPorCuenta: Map<string, number>;
}) {
  const filas = useMemo(() => {
    return cuentas.map((c) => {
      const pnl = pnlPorCuenta.get(c.id) ?? 0;
      const retirado = retiradoPorCuenta.get(c.id) ?? 0;
      const balanceActual = c.starting_balance + pnl - retirado;
      // "Invertido" = lo que realmente pagaste por la cuenta (purchase_cost).
      // Si no lo cargaste, usamos el balance inicial como aproximación.
      const invertido = c.purchase_cost ?? c.starting_balance;
      const roi = invertido > 0 ? ((retirado - invertido) / invertido) * 100 : 0;
      const recuperado = retirado >= invertido;
      const diferencia = retirado - invertido;
      return {
        cuenta: c,
        pnl,
        retirado,
        balanceActual,
        roi,
        invertido,
        costoSinCargar: c.purchase_cost === null,
        recuperado,
        diferencia,
      };
    });
  }, [cuentas, pnlPorCuenta, retiradoPorCuenta]);

  const totales = useMemo(() => {
    const invertido = filas.reduce((acc, f) => acc + f.invertido, 0);
    const retirado = filas.reduce((acc, f) => acc + f.retirado, 0);
    const roi = invertido > 0 ? ((retirado - invertido) / invertido) * 100 : 0;
    return { invertido, retirado, roi };
  }, [filas]);

  if (cuentas.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-kb-border bg-kb-surface p-8 text-center">
        <p className="text-sm text-kb-text-secondary">Crea una cuenta para ver su ROI aquí.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-kb-border-soft bg-kb-surface/60 p-4">
        <p className="text-xs text-kb-text-secondary">
          <span className="font-semibold text-kb-text">Cómo leer esta tabla:</span>{" "}
          <span className="font-medium text-kb-text">Invertido</span> es lo que pagaste por la
          cuenta (el fee del challenge, no el balance de $10K/$50K que te dan).{" "}
          <span className="font-medium text-kb-text">Retirado</span> es la plata real que ya
          sacaste. Cuando lo retirado supera lo invertido, ya "recuperaste" tu gasto y todo lo
          que sigas retirando es ganancia extra de verdad.
        </p>
      </section>

      <RoiResumenPanel
        invertido={totales.invertido}
        retirado={totales.retirado}
        roiPorcentaje={totales.roi}
        onVerDetalle={() => {}}
      />

      <section className="rounded-xl border border-kb-border bg-kb-surface">
        <div className="border-b border-kb-border-soft px-5 py-4">
          <h2 className="font-display text-lg font-semibold">ROI por cuenta</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-kb-border-soft text-xs text-kb-text-secondary">
                <th className="px-5 py-3 font-medium">Cuenta</th>
                <th className="px-5 py-3 font-medium">Tamaño</th>
                <th className="px-5 py-3 font-medium">Invertido</th>
                <th className="px-5 py-3 font-medium">P&amp;L</th>
                <th className="px-5 py-3 font-medium">Retirado</th>
                <th className="px-5 py-3 font-medium">Recuperación</th>
                <th className="px-5 py-3 font-medium">Balance actual</th>
                <th className="px-5 py-3 font-medium">ROI</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.cuenta.id} className="border-b border-kb-border-soft">
                  <td className="px-5 py-3 font-medium">{f.cuenta.name}</td>
                  <td className="px-5 py-3 font-mono text-kb-text-secondary">
                    {formatCurrency(f.cuenta.starting_balance)}
                  </td>
                  <td className="px-5 py-3 font-mono text-kb-text-secondary">
                    {formatCurrency(f.invertido)}
                    {f.costoSinCargar && (
                      <span
                        className="ml-1.5 text-[10px] text-kb-accent"
                        title="No cargaste el costo real de esta cuenta — se está usando el balance inicial como aproximación. Editala en Cuentas para corregirlo."
                      >
                        ⚠️ estimado
                      </span>
                    )}
                  </td>
                  <td className={`px-5 py-3 font-mono ${f.pnl >= 0 ? "text-kb-gain" : "text-kb-loss"}`}>
                    {formatCurrency(f.pnl)}
                  </td>
                  <td className="px-5 py-3 font-mono text-kb-gain">{formatCurrency(f.retirado)}</td>
                  <td className="px-5 py-3">
                    {f.recuperado ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-kb-gain/10 px-2 py-1 text-xs font-medium text-kb-gain">
                        ✅ Recuperado {f.diferencia > 0 ? `· +${formatCurrency(f.diferencia)} extra` : ""}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-kb-accent/10 px-2 py-1 text-xs font-medium text-kb-accent">
                        🔄 Faltan {formatCurrency(Math.abs(f.diferencia))}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 font-mono font-semibold">{formatCurrency(f.balanceActual)}</td>
                  <td className={`px-5 py-3 font-mono font-semibold ${f.roi >= 0 ? "text-kb-gain" : "text-kb-loss"}`}>
                    {f.roi.toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// =====================================================================
// VISTA: RETIROS — registrar y ver el historial de retiros por cuenta
// =====================================================================

function RetirosView({
  cuentas,
  cuentaActivaId,
  retiros,
  cargando,
  onCambio,
}: {
  cuentas: Account[];
  cuentaActivaId: CuentaSeleccion;
  retiros: Withdrawal[];
  cargando: boolean;
  onCambio: () => void;
}) {
  const cuentaParaRetiro = cuentaActivaId === "todas" ? "" : cuentaActivaId;
  const [accountId, setAccountId] = useState(cuentaParaRetiro || cuentas[0]?.id || "");
  const [amount, setAmount] = useState("");
  const [fecha, setFecha] = useState(() => todayKey());
  const [notes, setNotes] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const monto = parseFloat(amount);
    if (!accountId || Number.isNaN(monto) || monto <= 0) {
      setError("Selecciona una cuenta e ingresa un monto válido.");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setError("Tu sesión expiró. Vuelve a iniciar sesión.");
      return;
    }

    setEnviando(true);
    const { error: insertError } = await conReintento(() =>
      supabase.from("withdrawals").insert({
        user_id: userId,
        account_id: accountId,
        amount: monto,
        withdrawal_date: fecha,
        notes: notes.trim() === "" ? null : notes.trim(),
      })
    );
    setEnviando(false);

    if (insertError) {
      setError(
        `No se pudo registrar el retiro (lo intentamos dos veces). Revisa tu conexión e intenta de nuevo. Detalle: ${insertError.message}`
      );
      return;
    }

    setAmount("");
    setNotes("");
    onCambio();
  }

  async function eliminar(id: string) {
    await supabase.from("withdrawals").delete().eq("id", id);
    onCambio();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-kb-border bg-kb-surface p-5">
        <h2 className="font-display text-lg font-semibold mb-1">Registrar retiro</h2>
        <p className="mb-4 text-sm text-kb-text-secondary">
          Cuando retiras ganancias de una cuenta, regístralo aquí para que tu balance y ROI
          reflejen la realidad.
        </p>

        {cuentas.length === 0 ? (
          <p className="rounded-lg border border-kb-accent/30 bg-kb-accent/10 px-3 py-2 text-xs text-kb-accent">
            Crea una cuenta primero para poder registrar retiros.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Cuenta">
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputClass}>
                {cuentas.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Monto retirado">
              <input
                required
                type="number"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Ej. 500"
                className={inputClass}
              />
            </Campo>
            <Campo etiqueta="Fecha">
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputClass} />
            </Campo>
            <Campo etiqueta="Notas (opcional)">
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej. Primer payout"
                className={inputClass}
              />
            </Campo>

            {error && (
              <p className="sm:col-span-2 rounded-lg border border-kb-loss/30 bg-kb-loss/10 px-3 py-2 text-xs text-kb-loss">
                {error}
              </p>
            )}

            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={enviando}
                className="rounded-lg bg-kb-accent px-5 py-2.5 text-sm font-semibold text-kb-bg hover:brightness-110 transition disabled:opacity-60"
              >
                {enviando ? "Guardando…" : "Registrar retiro"}
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="rounded-xl border border-kb-border bg-kb-surface">
        <div className="border-b border-kb-border-soft px-5 py-4">
          <h2 className="font-display text-lg font-semibold">Historial de retiros</h2>
        </div>

        {cargando ? (
          <SkeletonFilas filas={4} />
        ) : retiros.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-kb-text-secondary">
            Todavía no registraste ningún retiro.
          </p>
        ) : (
          <div className="divide-y divide-kb-border-soft">
            {retiros.map((r) => {
              const cuentaDelRetiro = cuentas.find((c) => c.id === r.account_id);
              return (
                <div key={r.id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <p className="text-sm font-medium">{cuentaDelRetiro?.name ?? "Cuenta eliminada"}</p>
                    <p className="text-xs text-kb-text-secondary">
                      {new Date(r.withdrawal_date + "T00:00:00").toLocaleDateString("es-ES", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                      {r.notes ? ` · ${r.notes}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-semibold text-kb-gain">
                      +{formatCurrency(r.amount)}
                    </span>
                    <button
                      onClick={() => eliminar(r.id)}
                      className="text-xs text-kb-text-muted hover:text-kb-loss transition-colors"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

// =====================================================================
// VISTA: LOGROS — certificados de fondeo, solo relevante en cuentas
// reales. Permite subir una imagen o PDF como evidencia.
// =====================================================================

function esImagen(url: string): boolean {
  return /\.(png|jpe?g|gif|webp)$/i.test(url);
}

function LogrosView({
  cuentas,
  cuentaActivaId,
  logros,
  cargando,
  onCambio,
}: {
  cuentas: Account[];
  cuentaActivaId: CuentaSeleccion;
  logros: Achievement[];
  cargando: boolean;
  onCambio: () => void;
}) {
  const cuentasReales = useMemo(() => cuentas.filter((c) => c.account_type === "real"), [cuentas]);
  const [accountId, setAccountId] = useState(
    cuentaActivaId !== "todas" ? cuentaActivaId : cuentasReales[0]?.id ?? ""
  );
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<AchievementCategory>("fondeo");
  const [fecha, setFecha] = useState(() => todayKey());
  const [description, setDescription] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Ponele un título al logro (ej. 'Certificado FTMO 10K').");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setError("Tu sesión expiró. Vuelve a iniciar sesión.");
      return;
    }

    setSubiendo(true);
    let fileUrl: string | null = null;

    if (archivo) {
      const nombreLimpio = archivo.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
      const ruta = `${userId}/${Date.now()}-${nombreLimpio}`;
      const { error: uploadError } = await supabase.storage.from("achievements").upload(ruta, archivo);

      if (uploadError) {
        setSubiendo(false);
        setError("No se pudo subir el archivo. Intenta de nuevo.");
        return;
      }
      // Guardamos solo la ruta (el bucket es privado); la URL de acceso
      // temporal se genera al momento de mostrarla, no de guardarla.
      fileUrl = ruta;
    }

    const { error: insertError } = await supabase.from("achievements").insert({
      user_id: userId,
      account_id: accountId === "" ? null : accountId,
      title: title.trim(),
      category,
      description: description.trim() === "" ? null : description.trim(),
      file_url: fileUrl,
      achieved_date: fecha,
    });
    setSubiendo(false);

    if (insertError) {
      setError("No se pudo guardar el logro. Intenta de nuevo.");
      return;
    }

    setTitle("");
    setDescription("");
    setArchivo(null);
    onCambio();
  }

  async function eliminar(logro: Achievement) {
    await supabase.from("achievements").delete().eq("id", logro.id);
    onCambio();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-kb-border bg-kb-surface p-5">
        <h2 className="font-display text-lg font-semibold mb-1">🏆 Subir un logro</h2>
        <p className="mb-4 text-sm text-kb-text-secondary">
          Guardá tus certificados de fondeo, pasadas de challenge o cualquier hito importante.
        </p>

        {cuentasReales.length === 0 ? (
          <p className="rounded-lg border border-kb-accent/30 bg-kb-accent/10 px-3 py-2 text-xs text-kb-accent">
            Necesitás al menos una cuenta real para registrar logros.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCategory("fondeo")}
                className={`rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                  category === "fondeo"
                    ? "border-kb-accent bg-kb-accent/10 text-kb-accent"
                    : "border-kb-border text-kb-text-secondary hover:border-kb-text-secondary"
                }`}
              >
                🏆 Certificado de fondeo
              </button>
              <button
                type="button"
                onClick={() => setCategory("retiro")}
                className={`rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                  category === "retiro"
                    ? "border-kb-accent bg-kb-accent/10 text-kb-accent"
                    : "border-kb-border text-kb-text-secondary hover:border-kb-text-secondary"
                }`}
              >
                💵 Certificado de retiro
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo etiqueta="Título" ayuda="Ej. Certificado FTMO 10K, Fase 1 aprobada…">
                <input
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Certificado de fondeo"
                  className={inputClass}
                />
              </Campo>
              <Campo etiqueta="Cuenta relacionada">
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputClass}>
                  <option value="">Sin cuenta específica</option>
                  {cuentasReales.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </Campo>
              <Campo etiqueta="Fecha">
                <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputClass} />
              </Campo>
              <Campo etiqueta="Archivo (imagen o PDF, opcional)">
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
                  className={`${inputClass} py-1.5`}
                />
              </Campo>
            </div>

            <Campo etiqueta="Descripción (opcional)">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Ej: Pasé la fase 1 en 8 días, drawdown máximo 3%."
                className={`${inputClass} resize-none`}
              />
            </Campo>

            {error && (
              <p className="rounded-lg border border-kb-loss/30 bg-kb-loss/10 px-3 py-2 text-xs text-kb-loss">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={subiendo}
              className="rounded-lg bg-kb-accent px-5 py-2.5 text-sm font-semibold text-kb-bg hover:brightness-110 transition disabled:opacity-60"
            >
              {subiendo ? "Subiendo…" : "Guardar logro"}
            </button>
          </form>
        )}
      </section>

      <SeccionLogros
        titulo="🏆 Certificados de fondeo"
        logros={logros.filter((l) => l.category === "fondeo")}
        cuentas={cuentas}
        cargando={cargando}
        onEliminar={eliminar}
        vacio="Todavía no subiste ningún certificado de fondeo."
      />

      <SeccionLogros
        titulo="💵 Certificados de retiro"
        logros={logros.filter((l) => l.category === "retiro")}
        cuentas={cuentas}
        cargando={cargando}
        onEliminar={eliminar}
        vacio="Todavía no subiste ningún certificado de retiro."
      />

      {logros.some((l) => l.category === "otro") && (
        <SeccionLogros
          titulo="🎖️ Otros logros"
          logros={logros.filter((l) => l.category === "otro")}
          cuentas={cuentas}
          cargando={cargando}
          onEliminar={eliminar}
          vacio=""
        />
      )}
    </div>
  );
}

function SeccionLogros({
  titulo,
  logros,
  cuentas,
  cargando,
  onEliminar,
  vacio,
}: {
  titulo: string;
  logros: Achievement[];
  cuentas: Account[];
  cargando: boolean;
  onEliminar: (logro: Achievement) => void;
  vacio: string;
}) {
  return (
    <section className="rounded-xl border border-kb-border bg-kb-surface">
      <div className="border-b border-kb-border-soft px-5 py-4">
        <h2 className="font-display text-lg font-semibold">{titulo}</h2>
      </div>

      {cargando ? (
        <SkeletonTarjetas cantidad={3} />
      ) : logros.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-kb-text-secondary">{vacio}</p>
      ) : (
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          {logros.map((logro) => (
            <TarjetaLogro
              key={logro.id}
              logro={logro}
              cuenta={cuentas.find((c) => c.id === logro.account_id)}
              onEliminar={() => onEliminar(logro)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function TarjetaLogro({
  logro,
  cuenta,
  onEliminar,
}: {
  logro: Achievement;
  cuenta: Account | undefined;
  onEliminar: () => void;
}) {
  const [urlFirmada, setUrlFirmada] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    async function resolver() {
      if (!logro.file_url) return;
      const ruta = extraerRutaStorage("achievements", logro.file_url);
      const { data } = await supabase.storage.from("achievements").createSignedUrl(ruta, 3600);
      if (activo) setUrlFirmada(data?.signedUrl ?? null);
    }
    resolver();
    return () => {
      activo = false;
    };
  }, [logro.file_url]);

  return (
    <div className="overflow-hidden rounded-lg border border-kb-border-soft bg-kb-bg">
      {logro.file_url && esImagen(logro.file_url) ? (
        urlFirmada ? (
          <a href={urlFirmada} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={urlFirmada} alt={logro.title} className="h-36 w-full object-cover" />
          </a>
        ) : (
          <SkeletonBloque className="h-36 w-full rounded-none" />
        )
      ) : logro.file_url ? (
        <a
          href={urlFirmada ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-36 w-full items-center justify-center bg-kb-surface text-4xl"
        >
          📄
        </a>
      ) : (
        <div className="flex h-36 w-full items-center justify-center bg-kb-surface text-4xl">🏆</div>
      )}
      <div className="p-3">
        <p className="text-sm font-semibold leading-tight">{logro.title}</p>
        <p className="mt-0.5 text-xs text-kb-text-secondary">
          {formatDate(logro.achieved_date)}
          {cuenta ? ` · ${cuenta.name}` : ""}
        </p>
        {logro.description && (
          <p className="mt-1 text-xs text-kb-text-muted line-clamp-2">{logro.description}</p>
        )}
        <button
          onClick={onEliminar}
          className="mt-2 text-[11px] text-kb-text-muted hover:text-kb-loss transition-colors"
        >
          Eliminar
        </button>
      </div>
    </div>
  );
}

function PerfilView({ session }: { session: Session }) {
  const [perfil, setPerfil] = useState<Profile | null>(null);
  const [cargandoPerfil, setCargandoPerfil] = useState(true);

  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [bio, setBio] = useState("");
  const [tradingStyle, setTradingStyle] = useState("");
  const [startedYear, setStartedYear] = useState("");
  const [location, setLocation] = useState("");
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const [guardandoPerfil, setGuardandoPerfil] = useState(false);
  const [mensajePerfil, setMensajePerfil] = useState<string | null>(null);
  const [errorPerfil, setErrorPerfil] = useState<string | null>(null);

  const [nuevaPassword, setNuevaPassword] = useState("");
  const [confirmarPassword, setConfirmarPassword] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function cargarPerfil() {
      setCargandoPerfil(true);
      const { data } = await supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
      const p = data as Profile | null;
      setPerfil(p);
      setDisplayName(p?.display_name ?? "");
      setAvatarUrl(p?.avatar_url ?? null);
      setBio(p?.bio ?? "");
      setTradingStyle(p?.trading_style ?? "");
      setStartedYear(p?.started_year !== null && p?.started_year !== undefined ? String(p.started_year) : "");
      setLocation(p?.location ?? "");
      setCargandoPerfil(false);
    }
    cargarPerfil();
  }, [session.user.id]);

  async function subirFoto(archivo: File) {
    setSubiendoFoto(true);
    setErrorPerfil(null);
    const extension = archivo.name.split(".").pop();
    const ruta = `${session.user.id}/avatar-${Date.now()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from("avatars").upload(ruta, archivo, {
      upsert: true,
    });
    setSubiendoFoto(false);

    if (uploadError) {
      setErrorPerfil("No se pudo subir la foto. Intenta de nuevo.");
      return;
    }
    // Guardamos solo la ruta; la URL de acceso se genera al mostrarla.
    setAvatarUrl(ruta);
  }

  async function guardarPerfil(e: FormEvent) {
    e.preventDefault();
    setErrorPerfil(null);
    setMensajePerfil(null);
    setGuardandoPerfil(true);

    const { error: upsertError } = await supabase.from("profiles").upsert({
      id: session.user.id,
      display_name: displayName.trim() === "" ? null : displayName.trim(),
      avatar_url: avatarUrl,
      bio: bio.trim() === "" ? null : bio.trim(),
      trading_style: tradingStyle.trim() === "" ? null : tradingStyle.trim(),
      started_year: startedYear.trim() === "" ? null : parseInt(startedYear, 10),
      location: location.trim() === "" ? null : location.trim(),
      updated_at: new Date().toISOString(),
    });
    setGuardandoPerfil(false);

    if (upsertError) {
      setErrorPerfil(`No se pudo guardar tu perfil: ${upsertError.message}`);
      return;
    }
    setMensajePerfil("Perfil actualizado ✅");
  }

  async function cambiarPassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMensaje(null);

    if (nuevaPassword.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (nuevaPassword !== confirmarPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setEnviando(true);
    const { error: updateError } = await supabase.auth.updateUser({ password: nuevaPassword });
    setEnviando(false);

    if (updateError) {
      setError("No se pudo actualizar la contraseña. Intenta de nuevo.");
      return;
    }
    setMensaje("Contraseña actualizada correctamente.");
    setNuevaPassword("");
    setConfirmarPassword("");
  }

  const nombreMostrado = displayName.trim() !== "" ? displayName : nombreDesdeEmail(session.user.email);
  const inicial = nombreMostrado.slice(0, 1).toUpperCase();

  return (
    <div className="max-w-2xl space-y-6">
      {/* ---------- Mural del perfil ---------- */}
      <section className="overflow-hidden rounded-xl border border-kb-border bg-kb-surface">
        <div className="h-24 bg-gradient-to-r from-kb-accent/25 via-kb-gain/20 to-kb-accent/10" />
        <div className="px-5 pb-5">
          <div className="-mt-12 flex items-end justify-between">
            <div className="relative">
              <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-4 border-kb-surface bg-kb-accent/15 text-3xl font-bold text-kb-accent">
                {avatarUrl ? (
                  <ImagenPrivada
                    bucket="avatars"
                    path={avatarUrl}
                    alt={nombreMostrado}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  inicial
                )}
              </div>
              <label className="absolute bottom-0 right-0 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-2 border-kb-surface bg-kb-accent text-xs text-kb-bg hover:brightness-110 transition">
                📷
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const archivo = e.target.files?.[0];
                    if (archivo) subirFoto(archivo);
                  }}
                />
              </label>
            </div>
          </div>

          <div className="mt-3">
            <h1 className="font-display text-xl font-bold text-kb-text">
              {cargandoPerfil ? "Cargando…" : nombreMostrado}
            </h1>
            <p className="text-sm text-kb-text-secondary">{session.user.email}</p>
            {subiendoFoto && <p className="mt-1 text-xs text-kb-accent">Subiendo foto…</p>}
          </div>

          {!cargandoPerfil && (bio || tradingStyle || startedYear || location) && (
            <div className="mt-4 space-y-2">
              {bio && <p className="text-sm text-kb-text">{bio}</p>}
              <div className="flex flex-wrap gap-2 text-xs text-kb-text-secondary">
                {tradingStyle && (
                  <span className="rounded-full bg-kb-bg px-2.5 py-1 border border-kb-border-soft">📈 {tradingStyle}</span>
                )}
                {startedYear && (
                  <span className="rounded-full bg-kb-bg px-2.5 py-1 border border-kb-border-soft">🗓️ Trading desde {startedYear}</span>
                )}
                {location && (
                  <span className="rounded-full bg-kb-bg px-2.5 py-1 border border-kb-border-soft">📍 {location}</span>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ---------- Editar perfil ---------- */}
      <section className="rounded-xl border border-kb-border bg-kb-surface p-5">
        <h2 className="font-display text-lg font-semibold mb-4">Editar perfil</h2>
        <form onSubmit={guardarPerfil} className="space-y-4">
          <Campo etiqueta="Nombre para mostrar">
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={nombreDesdeEmail(session.user.email)}
              className={inputClass}
            />
          </Campo>

          <Campo etiqueta="Bio" ayuda="Una frase corta sobre vos como trader">
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={2}
              placeholder="Ej: Trader de forex e índices, enfocado en price action y gestión de riesgo."
              className={`${inputClass} resize-none`}
            />
          </Campo>

          <div className="grid gap-4 sm:grid-cols-3">
            <Campo etiqueta="Estilo de trading" ayuda="Ej. Scalping, Day trading, Swing">
              <input
                value={tradingStyle}
                onChange={(e) => setTradingStyle(e.target.value)}
                placeholder="Day trading"
                className={inputClass}
              />
            </Campo>
            <Campo etiqueta="Operando desde">
              <input
                type="number"
                value={startedYear}
                onChange={(e) => setStartedYear(e.target.value)}
                placeholder="2023"
                className={inputClass}
              />
            </Campo>
            <Campo etiqueta="Ubicación (opcional)">
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Ciudad, país"
                className={inputClass}
              />
            </Campo>
          </div>

          {errorPerfil && (
            <p className="rounded-lg border border-kb-loss/30 bg-kb-loss/10 px-3 py-2 text-xs text-kb-loss">{errorPerfil}</p>
          )}
          {mensajePerfil && (
            <p className="rounded-lg border border-kb-gain/30 bg-kb-gain/10 px-3 py-2 text-xs text-kb-gain">{mensajePerfil}</p>
          )}

          <button
            type="submit"
            disabled={guardandoPerfil}
            className="rounded-lg bg-kb-accent px-5 py-2.5 text-sm font-semibold text-kb-bg hover:brightness-110 transition disabled:opacity-60"
          >
            {guardandoPerfil ? "Guardando…" : "Guardar perfil"}
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-kb-border bg-kb-surface p-5">
        <h2 className="font-display text-lg font-semibold mb-4">Tu cuenta</h2>
        <div className="space-y-1">
          <p className="text-xs text-kb-text-secondary">Correo electrónico</p>
          <p className="text-sm font-medium">{session.user.email}</p>
        </div>
        <div className="mt-3 space-y-1">
          <p className="text-xs text-kb-text-secondary">Miembro desde</p>
          <p className="text-sm font-medium">
            {session.user.created_at ? formatDate(session.user.created_at) : "—"}
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-kb-border bg-kb-surface p-5">
        <h2 className="font-display text-lg font-semibold mb-4">Cambiar contraseña</h2>
        <form onSubmit={cambiarPassword} className="space-y-4">
          <Campo etiqueta="Nueva contraseña">
            <input
              type="password"
              minLength={6}
              value={nuevaPassword}
              onChange={(e) => setNuevaPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres"
              className={inputClass}
            />
          </Campo>
          <Campo etiqueta="Confirmar nueva contraseña">
            <input
              type="password"
              minLength={6}
              value={confirmarPassword}
              onChange={(e) => setConfirmarPassword(e.target.value)}
              className={inputClass}
            />
          </Campo>

          {error && (
            <p className="rounded-lg border border-kb-loss/30 bg-kb-loss/10 px-3 py-2 text-xs text-kb-loss">
              {error}
            </p>
          )}
          {mensaje && (
            <p className="rounded-lg border border-kb-gain/30 bg-kb-gain/10 px-3 py-2 text-xs text-kb-gain">
              {mensaje}
            </p>
          )}

          <button
            type="submit"
            disabled={enviando}
            className="rounded-lg bg-kb-accent px-5 py-2.5 text-sm font-semibold text-kb-bg hover:brightness-110 transition disabled:opacity-60"
          >
            {enviando ? "Guardando…" : "Actualizar contraseña"}
          </button>
        </form>
      </section>
    </div>
  );
}

// =====================================================================
// VISTA: CONFIGURACIÓN — gestión de cuentas (crear vive en el header,
// aquí se edita/archiva/elimina, y se pueden ver las archivadas)
// =====================================================================

function ConfiguracionView({
  cuentas,
  onCambio,
  onVerArchivadas,
}: {
  cuentas: Account[];
  onCambio: () => void;
  onVerArchivadas: () => void;
}) {
  const [cuentaEditando, setCuentaEditando] = useState<Account | null>(null);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-kb-border bg-kb-surface">
        <div className="flex items-center justify-between border-b border-kb-border-soft px-5 py-4">
          <h2 className="font-display text-lg font-semibold">Tus cuentas</h2>
          <button
            onClick={onVerArchivadas}
            className="text-xs text-kb-text-secondary hover:text-kb-accent transition-colors underline-offset-2 hover:underline"
          >
            Ver cuentas archivadas
          </button>
        </div>

        {cuentas.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-kb-text-secondary">
            No tienes ninguna cuenta activa todavía.
          </p>
        ) : (
          <div className="divide-y divide-kb-border-soft">
            {cuentas.map((c) => (
              <FilaCuentaConfig
                key={c.id}
                cuenta={c}
                onEditar={() => setCuentaEditando(c)}
                onCambio={onCambio}
              />
            ))}
          </div>
        )}
      </section>

      <ExportarBackup />

      {cuentaEditando && (
        <ModalEditarCuenta
          cuenta={cuentaEditando}
          onClose={() => setCuentaEditando(null)}
          onGuardada={() => {
            setCuentaEditando(null);
            onCambio();
          }}
        />
      )}
    </div>
  );
}

// =====================================================================
// EXPORTAR BACKUP — descarga tus datos como CSV (trades) o JSON
// (todo: cuentas, trades, estrategias, retiros, logros)
// =====================================================================

function descargarArchivo(contenido: string, nombreArchivo: string, tipo: string) {
  const blob = new Blob([contenido], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function celdaCSV(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  const texto = Array.isArray(valor) ? valor.join(" | ") : String(valor);
  return `"${texto.replace(/"/g, '""')}"`;
}

function ExportarBackup() {
  const [exportando, setExportando] = useState<"csv" | "json" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function exportarTradesCSV() {
    setExportando("csv");
    setError(null);
    const { data, error: fetchError } = await supabase
      .from("trades")
      .select("*")
      .order("entry_time", { ascending: true });
    setExportando(null);

    if (fetchError || !data) {
      setError("No se pudo generar el CSV. Intenta de nuevo.");
      return;
    }

    const columnas = [
      "symbol", "instrument_type", "side", "status", "quantity",
      "entry_price", "exit_price", "pips", "fees", "realized_pnl",
      "result_type", "session", "emotion", "mistake", "risk_amount",
      "notes", "entry_time", "exit_time",
    ];
    const filas = data.map((t) =>
      columnas.map((col) => celdaCSV((t as unknown as Record<string, unknown>)[col])).join(",")
    );
    const csv = [columnas.join(","), ...filas].join("\n");
    descargarArchivo(csv, `kebotrader-trades-${todayKey()}.csv`, "text/csv;charset=utf-8;");
  }

  async function exportarBackupCompleto() {
    setExportando("json");
    setError(null);

    const [trades, accounts, strategies, withdrawals, achievements] = await Promise.all([
      supabase.from("trades").select("*"),
      supabase.from("accounts").select("*"),
      supabase.from("strategies").select("*"),
      supabase.from("withdrawals").select("*"),
      supabase.from("achievements").select("*"),
    ]);
    setExportando(null);

    const backup = {
      exportado_en: new Date().toISOString(),
      cuentas: accounts.data ?? [],
      trades: trades.data ?? [],
      estrategias: strategies.data ?? [],
      retiros: withdrawals.data ?? [],
      logros: achievements.data ?? [],
    };
    descargarArchivo(JSON.stringify(backup, null, 2), `kebotrader-backup-${todayKey()}.json`, "application/json");
  }

  return (
    <section className="rounded-xl border border-kb-border bg-kb-surface p-5">
      <h2 className="font-display text-lg font-semibold mb-1">Exportar tus datos</h2>
      <p className="mb-4 text-sm text-kb-text-secondary">
        Descargá tu propia copia de seguridad. Nunca está de más tener tus datos también en tu
        computadora, además de en la nube.
      </p>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={exportarTradesCSV}
          disabled={exportando !== null}
          className="rounded-lg border border-kb-border px-4 py-2.5 text-sm font-medium text-kb-text hover:border-kb-accent hover:text-kb-accent transition-colors disabled:opacity-60"
        >
          {exportando === "csv" ? "Generando…" : "📄 Exportar trades (CSV)"}
        </button>
        <button
          onClick={exportarBackupCompleto}
          disabled={exportando !== null}
          className="rounded-lg border border-kb-border px-4 py-2.5 text-sm font-medium text-kb-text hover:border-kb-accent hover:text-kb-accent transition-colors disabled:opacity-60"
        >
          {exportando === "json" ? "Generando…" : "💾 Backup completo (JSON)"}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-kb-loss/30 bg-kb-loss/10 px-3 py-2 text-xs text-kb-loss">
          {error}
        </p>
      )}
    </section>
  );
}

function FilaCuentaConfig({
  cuenta,
  onEditar,
  onCambio,
}: {
  cuenta: Account;
  onEditar: () => void;
  onCambio: () => void;
}) {
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false);
  const [procesando, setProcesando] = useState(false);

  async function archivar() {
    setProcesando(true);
    await supabase.from("accounts").update({ is_archived: true }).eq("id", cuenta.id);
    setProcesando(false);
    onCambio();
  }

  async function eliminar() {
    setProcesando(true);
    await supabase.from("accounts").delete().eq("id", cuenta.id);
    setProcesando(false);
    setConfirmandoEliminar(false);
    onCambio();
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <div>
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold">{cuenta.name}</p>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              cuenta.account_type === "real"
                ? "bg-kb-loss/10 text-kb-loss"
                : "bg-kb-gain/10 text-kb-gain"
            }`}
          >
            {cuenta.account_type === "real" ? "Real" : "Demo"}
          </span>
          {cuenta.phase !== "no_aplica" && (
            <span className="rounded-full bg-kb-accent/10 px-2 py-0.5 text-[11px] font-medium text-kb-accent">
              {PHASE_LABELS[cuenta.phase]}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-kb-text-secondary">
          {cuenta.broker ? `${cuenta.broker} · ` : ""}
          Balance inicial {formatCurrency(cuenta.starting_balance)}
          {cuenta.max_daily_loss ? ` · Pérdida diaria máx. ${formatCurrency(cuenta.max_daily_loss)}` : ""}
          {cuenta.max_total_loss ? ` · Pérdida total máx. ${formatCurrency(cuenta.max_total_loss)}` : ""}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={onEditar}
          className="rounded-lg border border-kb-border px-3 py-1.5 text-xs font-medium text-kb-text-secondary hover:border-kb-accent hover:text-kb-accent transition-colors"
        >
          Editar
        </button>
        <button
          onClick={archivar}
          disabled={procesando}
          className="rounded-lg border border-kb-border px-3 py-1.5 text-xs font-medium text-kb-text-secondary hover:text-kb-text transition-colors disabled:opacity-60"
        >
          Archivar
        </button>
        <button
          onClick={() => setConfirmandoEliminar(true)}
          disabled={procesando}
          className="rounded-lg border border-kb-loss/30 px-3 py-1.5 text-xs font-medium text-kb-loss hover:bg-kb-loss/10 transition-colors disabled:opacity-60"
        >
          Eliminar
        </button>
      </div>

      {confirmandoEliminar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-kb-border bg-kb-surface p-6 shadow-2xl">
            <h3 className="font-display text-lg font-bold text-kb-text">
              ¿Eliminar &quot;{cuenta.name}&quot;?
            </h3>
            <p className="mt-2 text-sm text-kb-text-secondary">
              Esta acción no se puede deshacer. Tus operaciones registradas en ella no se
              borrarán, pero quedarán sin cuenta asignada.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setConfirmandoEliminar(false)}
                className="flex-1 rounded-lg border border-kb-border py-2 text-sm font-medium text-kb-text-secondary hover:text-kb-text transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={eliminar}
                disabled={procesando}
                className="flex-1 rounded-lg bg-kb-loss py-2 text-sm font-semibold text-white hover:brightness-110 transition disabled:opacity-60"
              >
                {procesando ? "Eliminando…" : "Sí, eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// MODAL: editar cuenta existente
// =====================================================================

function ModalEditarCuenta({
  cuenta,
  onClose,
  onGuardada,
}: {
  cuenta: Account;
  onClose: () => void;
  onGuardada: () => void;
}) {
  const [name, setName] = useState(cuenta.name);
  const [broker, setBroker] = useState(cuenta.broker ?? "");
  const [accountType, setAccountType] = useState<AccountType>(cuenta.account_type);
  const [phase, setPhase] = useState<AccountPhase>(cuenta.phase);
  const [startingBalance, setStartingBalance] = useState(String(cuenta.starting_balance));
  const [purchaseCost, setPurchaseCost] = useState(
    cuenta.purchase_cost !== null ? String(cuenta.purchase_cost) : ""
  );
  const [maxDailyLoss, setMaxDailyLoss] = useState(
    cuenta.max_daily_loss !== null ? String(cuenta.max_daily_loss) : ""
  );
  const [maxTotalLoss, setMaxTotalLoss] = useState(
    cuenta.max_total_loss !== null ? String(cuenta.max_total_loss) : ""
  );
  const [description, setDescription] = useState(cuenta.description ?? "");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const balance = parseFloat(startingBalance);
    if (!name.trim() || Number.isNaN(balance)) {
      setError("El nombre y el balance inicial son obligatorios.");
      return;
    }

    setEnviando(true);
    const { error: updateError } = await supabase
      .from("accounts")
      .update({
        name: name.trim(),
        broker: broker.trim() === "" ? null : broker.trim(),
        account_type: accountType,
        phase,
        starting_balance: balance,
        purchase_cost: purchaseCost.trim() === "" ? null : parseFloat(purchaseCost),
        max_daily_loss: maxDailyLoss.trim() === "" ? null : parseFloat(maxDailyLoss),
        max_total_loss: maxTotalLoss.trim() === "" ? null : parseFloat(maxTotalLoss),
        description: description.trim() === "" ? null : description.trim(),
      })
      .eq("id", cuenta.id);
    setEnviando(false);

    if (updateError) {
      setError("No se pudo guardar los cambios. Intenta de nuevo.");
      return;
    }
    onGuardada();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 overflow-y-auto">
      <div className="w-full max-h-[85vh] max-w-md overflow-y-auto rounded-2xl border border-kb-border bg-kb-surface p-7 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">Editar cuenta</h2>
          <button
            onClick={onClose}
            className="text-kb-text-muted hover:text-kb-text transition"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Campo etiqueta="Nombre de la cuenta">
            <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </Campo>

          <Campo etiqueta="Empresa / Broker">
            <input value={broker} onChange={(e) => setBroker(e.target.value)} className={inputClass} />
          </Campo>

          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Tipo de cuenta">
              <select
                value={accountType}
                onChange={(e) => setAccountType(e.target.value as AccountType)}
                className={inputClass}
              >
                <option value="demo">Demo</option>
                <option value="real">Real</option>
              </select>
            </Campo>

            <Campo etiqueta="Fase">
              <select
                value={phase}
                onChange={(e) => setPhase(e.target.value as AccountPhase)}
                className={inputClass}
              >
                <option value="no_aplica">No aplica</option>
                <option value="fase_1">Fase 1</option>
                <option value="fase_2">Fase 2</option>
                <option value="financiada">Financiada</option>
              </select>
            </Campo>
          </div>

          <Campo etiqueta="Balance inicial">
            <input
              required
              type="number"
              step="any"
              value={startingBalance}
              onChange={(e) => setStartingBalance(e.target.value)}
              className={inputClass}
            />
          </Campo>

          <Campo
            etiqueta="Costo de la cuenta (opcional)"
            ayuda="Lo que pagaste por ella — se usa como 'Invertido' en el ROI"
          >
            <input
              type="number"
              step="any"
              value={purchaseCost}
              onChange={(e) => setPurchaseCost(e.target.value)}
              placeholder="Ej. 99"
              className={inputClass}
            />
          </Campo>

          <div className="rounded-lg border border-kb-border-soft bg-kb-bg p-3">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-kb-accent">
              Reglas de la cuenta (opcional)
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Pérdida máx. diaria">
                <input
                  type="number"
                  step="any"
                  value={maxDailyLoss}
                  onChange={(e) => setMaxDailyLoss(e.target.value)}
                  placeholder="500"
                  className={inputClass}
                />
              </Campo>
              <Campo etiqueta="Pérdida máx. total">
                <input
                  type="number"
                  step="any"
                  value={maxTotalLoss}
                  onChange={(e) => setMaxTotalLoss(e.target.value)}
                  placeholder="1000"
                  className={inputClass}
                />
              </Campo>
            </div>
          </div>

          <Campo etiqueta="Descripción (opcional)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className={`${inputClass} resize-none`}
            />
          </Campo>

          {error && (
            <p className="rounded-lg border border-kb-loss/30 bg-kb-loss/10 px-3 py-2 text-xs text-kb-loss">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={enviando}
            className="w-full rounded-lg bg-kb-accent py-2.5 text-sm font-semibold text-kb-bg hover:brightness-110 transition disabled:opacity-60"
          >
            {enviando ? "Guardando…" : "Guardar cambios"}
          </button>
        </form>
      </div>
    </div>
  );
}

// =====================================================================
// BARRA DE LÍMITE DE PÉRDIDA
// =====================================================================

function BarraLimitePerdida({
  etiqueta,
  perdidaActual,
  limite,
}: {
  etiqueta: string;
  perdidaActual: number;
  limite: number;
}) {
  const porcentajeUsado = limite > 0 ? Math.min((perdidaActual / limite) * 100, 100) : 0;

  let colorBarra = "bg-kb-gain";
  let colorTexto = "text-kb-gain";
  if (porcentajeUsado >= 90) {
    colorBarra = "bg-kb-loss";
    colorTexto = "text-kb-loss";
  } else if (porcentajeUsado >= 60) {
    colorBarra = "bg-kb-accent";
    colorTexto = "text-kb-accent";
  }

  return (
    <div className="rounded-lg border border-kb-border-soft bg-kb-bg p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-xs text-kb-text-secondary">{etiqueta}</p>
        <p className={`font-mono text-xs font-semibold ${colorTexto}`}>
          {formatCurrency(perdidaActual)} / {formatCurrency(limite)}
        </p>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-kb-border">
        <div
          className={`h-full rounded-full transition-all ${colorBarra}`}
          style={{ width: `${porcentajeUsado}%` }}
        />
      </div>
      <p className="mt-1 text-right text-[11px] text-kb-text-muted">
        {porcentajeUsado.toFixed(0)}% usado
      </p>
    </div>
  );
}

// =====================================================================
// MODAL: crear nueva cuenta
// =====================================================================

function ModalNuevaCuenta({
  onClose,
  onCreada,
}: {
  onClose: () => void;
  onCreada: (cuenta: Account) => void;
}) {
  const [name, setName] = useState("");
  const [broker, setBroker] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("demo");
  const [phase, setPhase] = useState<AccountPhase>("no_aplica");
  const [startingBalance, setStartingBalance] = useState("10000");
  const [purchaseCost, setPurchaseCost] = useState("");
  const [maxDailyLoss, setMaxDailyLoss] = useState("");
  const [maxTotalLoss, setMaxTotalLoss] = useState("");
  const [description, setDescription] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const balance = parseFloat(startingBalance);
    if (!name.trim() || Number.isNaN(balance)) {
      setError("El nombre y el balance inicial son obligatorios.");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setError("Tu sesión expiró. Vuelve a iniciar sesión.");
      return;
    }

    setEnviando(true);
    const { data, error: insertError } = await supabase
      .from("accounts")
      .insert({
        user_id: userId,
        name: name.trim(),
        broker: broker.trim() === "" ? null : broker.trim(),
        account_type: accountType,
        phase,
        starting_balance: balance,
        purchase_cost: purchaseCost.trim() === "" ? null : parseFloat(purchaseCost),
        max_daily_loss: maxDailyLoss.trim() === "" ? null : parseFloat(maxDailyLoss),
        max_total_loss: maxTotalLoss.trim() === "" ? null : parseFloat(maxTotalLoss),
        description: description.trim() === "" ? null : description.trim(),
      })
      .select()
      .single();
    setEnviando(false);

    if (insertError || !data) {
      setError("No se pudo crear la cuenta. Intenta de nuevo.");
      return;
    }

    onCreada(data as Account);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 overflow-y-auto">
      <div className="w-full max-h-[85vh] max-w-md overflow-y-auto rounded-2xl border border-kb-border bg-kb-surface p-7 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">Nueva cuenta</h2>
          <button
            onClick={onClose}
            className="text-kb-text-muted hover:text-kb-text transition"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Campo etiqueta="Nombre de la cuenta" ayuda="Para identificarla rápido, ej. 'FTMO 10K' o 'Mi cuenta real'">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="FTMO 10K"
              className={inputClass}
            />
          </Campo>

          <Campo etiqueta="Empresa / Broker" ayuda="Quién te vendió o dónde abriste la cuenta">
            <input
              value={broker}
              onChange={(e) => setBroker(e.target.value)}
              placeholder="FTMO, IBKR, Schwab…"
              className={inputClass}
            />
          </Campo>

          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Tipo de cuenta">
              <select
                value={accountType}
                onChange={(e) => setAccountType(e.target.value as AccountType)}
                className={inputClass}
              >
                <option value="demo">Demo</option>
                <option value="real">Real</option>
              </select>
            </Campo>

            <Campo etiqueta="Fase">
              <select
                value={phase}
                onChange={(e) => setPhase(e.target.value as AccountPhase)}
                className={inputClass}
              >
                <option value="no_aplica">No aplica</option>
                <option value="fase_1">Fase 1</option>
                <option value="fase_2">Fase 2</option>
                <option value="financiada">Financiada</option>
              </select>
            </Campo>
          </div>

          <Campo etiqueta="Balance inicial" ayuda="El capital con el que arrancó la cuenta">
            <input
              required
              type="number"
              step="any"
              value={startingBalance}
              onChange={(e) => setStartingBalance(e.target.value)}
              className={inputClass}
            />
          </Campo>

          <Campo
            etiqueta="Costo de la cuenta (opcional)"
            ayuda="Lo que pagaste por ella (ej. el fee del challenge) — se usa como 'Invertido' en el ROI, no el balance"
          >
            <input
              type="number"
              step="any"
              value={purchaseCost}
              onChange={(e) => setPurchaseCost(e.target.value)}
              placeholder="Ej. 99"
              className={inputClass}
            />
          </Campo>

          <div className="rounded-lg border border-kb-border-soft bg-kb-bg p-3">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-kb-accent">
              Reglas de la cuenta (opcional)
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Campo
                etiqueta="Pérdida máx. diaria"
                ayuda={
                  maxDailyLoss && !Number.isNaN(parseFloat(startingBalance)) && parseFloat(startingBalance) > 0
                    ? `≈ ${((parseFloat(maxDailyLoss) / parseFloat(startingBalance)) * 100).toFixed(1)}% del balance`
                    : "Ej. 500"
                }
              >
                <input
                  type="number"
                  step="any"
                  value={maxDailyLoss}
                  onChange={(e) => setMaxDailyLoss(e.target.value)}
                  placeholder="500"
                  className={inputClass}
                />
              </Campo>

              <Campo
                etiqueta="Pérdida máx. total"
                ayuda={
                  maxTotalLoss && !Number.isNaN(parseFloat(startingBalance)) && parseFloat(startingBalance) > 0
                    ? `≈ ${((parseFloat(maxTotalLoss) / parseFloat(startingBalance)) * 100).toFixed(1)}% del balance`
                    : "Ej. 1000"
                }
              >
                <input
                  type="number"
                  step="any"
                  value={maxTotalLoss}
                  onChange={(e) => setMaxTotalLoss(e.target.value)}
                  placeholder="1000"
                  className={inputClass}
                />
              </Campo>
            </div>
          </div>

          <Campo etiqueta="Descripción (opcional)" ayuda="Objetivos, reglas de la cuenta, lo que quieras recordar">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Ej: Cuenta de fondeo, drawdown máximo 10%, objetivo 8% para pasar de fase…"
              className={`${inputClass} resize-none`}
            />
          </Campo>

          {error && (
            <p className="rounded-lg border border-kb-loss/30 bg-kb-loss/10 px-3 py-2 text-xs text-kb-loss">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={enviando}
            className="w-full rounded-lg bg-kb-accent py-2.5 text-sm font-semibold text-kb-bg hover:brightness-110 transition disabled:opacity-60"
          >
            {enviando ? "Creando…" : "Crear cuenta"}
          </button>
        </form>
      </div>
    </div>
  );
}

// =====================================================================
// MODAL: cuentas archivadas (ver y reactivar)
// =====================================================================

function ModalCuentasArchivadas({
  onClose,
  onReactivada,
}: {
  onClose: () => void;
  onReactivada: (cuenta: Account) => void;
}) {
  const [archivadas, setArchivadas] = useState<Account[]>([]);
  const [cargando, setCargando] = useState(true);
  const [reactivandoId, setReactivandoId] = useState<string | null>(null);

  async function cargarArchivadas() {
    setCargando(true);
    const { data } = await supabase
      .from("accounts")
      .select("*")
      .eq("is_archived", true)
      .order("created_at", { ascending: true });
    setArchivadas((data as Account[]) ?? []);
    setCargando(false);
  }

  useEffect(() => {
    cargarArchivadas();
  }, []);

  async function reactivar(cuenta: Account) {
    setReactivandoId(cuenta.id);
    const { data, error } = await supabase
      .from("accounts")
      .update({ is_archived: false })
      .eq("id", cuenta.id)
      .select()
      .single();
    setReactivandoId(null);

    if (!error && data) {
      setArchivadas((prev) => prev.filter((c) => c.id !== cuenta.id));
      onReactivada(data as Account);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 overflow-y-auto">
      <div className="w-full max-h-[85vh] max-w-md overflow-y-auto rounded-2xl border border-kb-border bg-kb-surface p-7 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">Cuentas archivadas</h2>
          <button
            onClick={onClose}
            className="text-kb-text-muted hover:text-kb-text transition"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        {cargando ? (
          <div className="space-y-2 py-2">
            <SkeletonBloque className="h-10 w-full" />
            <SkeletonBloque className="h-10 w-full" />
          </div>
        ) : archivadas.length === 0 ? (
          <p className="py-6 text-center text-sm text-kb-text-secondary">
            No tienes ninguna cuenta archivada.
          </p>
        ) : (
          <div className="space-y-2">
            {archivadas.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-lg border border-kb-border-soft bg-kb-bg px-3 py-2.5"
              >
                <div>
                  <p className="text-sm font-medium text-kb-text">{c.name}</p>
                  {c.broker && (
                    <p className="text-xs text-kb-text-secondary">{c.broker}</p>
                  )}
                </div>
                <button
                  onClick={() => reactivar(c)}
                  disabled={reactivandoId === c.id}
                  className="shrink-0 rounded-lg border border-kb-accent/40 px-3 py-1.5 text-xs font-medium text-kb-accent hover:bg-kb-accent/10 transition-colors disabled:opacity-60"
                >
                  {reactivandoId === c.id ? "Reactivando…" : "Reactivar"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// GRÁFICO DE P&L ACUMULADO
// =====================================================================

function formatEje(value: number): string {
  return `$${Math.round(value).toLocaleString("es-ES")}`;
}

function formatFechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

/**
 * Convierte una serie de puntos en un path SVG suavizado (curva tipo
 * Catmull-Rom convertida a Bézier cúbica), para que la línea no se vea
 * quebrada entre puntos, igual que en TradeLog.
 */
function suavizarPath(puntos: Array<{ x: number; y: number }>): string {
  if (puntos.length < 3) {
    return puntos.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  }

  let path = `M ${puntos[0].x} ${puntos[0].y}`;
  for (let i = 0; i < puntos.length - 1; i++) {
    const p0 = puntos[i - 1] ?? puntos[i];
    const p1 = puntos[i];
    const p2 = puntos[i + 1];
    const p3 = puntos[i + 2] ?? p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return path;
}

function GraficoPnL({ trades }: { trades: Trade[] }) {
  const contenedorRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const puntos = useMemo(() => {
    const cerrados = trades
      .filter((t) => t.status === "closed" && t.realized_pnl !== null)
      .sort((a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime());

    let acumulado = 0;
    return cerrados.map((t) => {
      acumulado += t.realized_pnl ?? 0;
      return { fecha: t.entry_time, acumulado, pnlTrade: t.realized_pnl ?? 0, symbol: t.symbol };
    });
  }, [trades]);

  if (puntos.length === 0) {
    return (
      <section className="h-full rounded-xl border border-kb-border bg-kb-surface p-5">
        <h2 className="font-display text-lg font-semibold mb-1">Curva de Equity</h2>
        <p className="py-8 text-center text-sm text-kb-text-secondary">
          Cierra operaciones para ver tu curva de rendimiento aquí.
        </p>
      </section>
    );
  }

  const ancho = 800;
  const alto = 260;
  const padL = 64;
  const padR = 16;
  const padT = 20;
  const padB = 30;

  const valores = puntos.map((p) => p.acumulado);
  const maxValRaw = Math.max(...valores, 0);
  const minValRaw = Math.min(...valores, 0);
  const rangoRaw = maxValRaw - minValRaw || 1;

  // Redondea el paso del eje Y a un número "lindo" (10, 20, 50, 100, 500…)
  const pasoBruto = rangoRaw / 4;
  const magnitud = Math.pow(10, Math.floor(Math.log10(pasoBruto || 1)));
  const pasoEje = Math.ceil(pasoBruto / magnitud) * magnitud || 1;
  const minEje = Math.floor(minValRaw / pasoEje) * pasoEje;
  const maxEje = Math.ceil(maxValRaw / pasoEje) * pasoEje;
  const rangoEje = maxEje - minEje || 1;

  const etiquetasEje: number[] = [];
  for (let v = minEje; v <= maxEje + pasoEje * 0.001; v += pasoEje) etiquetasEje.push(v);

  const coordX = (i: number) => padL + (i / Math.max(puntos.length - 1, 1)) * (ancho - padL - padR);
  const coordY = (v: number) => padT + (1 - (v - minEje) / rangoEje) * (alto - padT - padB);

  const puntosXY = puntos.map((p, i) => ({ x: coordX(i), y: coordY(p.acumulado) }));
  const lineaPath = suavizarPath(puntosXY);
  const areaPath = `${lineaPath} L ${coordX(puntos.length - 1)} ${coordY(minEje)} L ${coordX(0)} ${coordY(minEje)} Z`;

  const pnlFinal = puntos[puntos.length - 1].acumulado;
  const colorLinea = pnlFinal >= 0 ? "var(--kb-gain)" : "var(--kb-loss)";
  const idGradiente = `gradienteEquity-${pnlFinal >= 0 ? "gain" : "loss"}`;

  // Hasta 6 etiquetas de fecha en el eje X, repartidas parejo y sin repetir texto
  const cantidadTicksX = Math.min(6, puntos.length);
  const ticksXCrudos = Array.from({ length: cantidadTicksX }, (_, i) =>
    Math.round((i * (puntos.length - 1)) / Math.max(cantidadTicksX - 1, 1))
  );
  const etiquetasVistas = new Set<string>();
  const ticksX = ticksXCrudos.filter((i) => {
    const etiqueta = formatFechaCorta(puntos[i].fecha);
    if (etiquetasVistas.has(etiqueta)) return false;
    etiquetasVistas.add(etiqueta);
    return true;
  });

  function manejarMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!contenedorRef.current) return;
    const rect = contenedorRef.current.getBoundingClientRect();
    const xSvg = ((e.clientX - rect.left) / rect.width) * ancho;
    let mejorIndice = 0;
    let mejorDistancia = Infinity;
    puntos.forEach((_, i) => {
      const d = Math.abs(coordX(i) - xSvg);
      if (d < mejorDistancia) {
        mejorDistancia = d;
        mejorIndice = i;
      }
    });
    setHoverIndex(mejorIndice);
  }

  const puntoHover = hoverIndex !== null ? puntos[hoverIndex] : null;

  return (
    <section className="h-full rounded-xl border border-kb-border bg-kb-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-base font-semibold">Curva de Equity</h2>
        <span
          className={`rounded-lg border px-2.5 py-1 font-mono text-sm font-semibold ${
            pnlFinal >= 0
              ? "border-kb-gain/30 bg-kb-gain/10 text-kb-gain"
              : "border-kb-loss/30 bg-kb-loss/10 text-kb-loss"
          }`}
        >
          {formatCurrency(pnlFinal)}
        </span>
      </div>
      <div
        ref={contenedorRef}
        className="relative h-44 w-full sm:h-48"
        onMouseMove={manejarMouseMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <svg viewBox={`0 0 ${ancho} ${alto}`} className="h-full w-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id={idGradiente} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colorLinea} stopOpacity="0.35" />
              <stop offset="100%" stopColor={colorLinea} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Grilla horizontal */}
          {etiquetasEje.map((v) => (
            <line
              key={v}
              x1={padL}
              x2={ancho - padR}
              y1={coordY(v)}
              y2={coordY(v)}
              stroke="var(--kb-border)"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
          ))}

          <path d={areaPath} fill={`url(#${idGradiente})`} />
          <path d={lineaPath} fill="none" stroke={colorLinea} strokeWidth="2" />

          {/* Línea vertical + punto resaltado al pasar el mouse */}
          {hoverIndex !== null && (
            <>
              <line
                x1={coordX(hoverIndex)}
                x2={coordX(hoverIndex)}
                y1={padT}
                y2={alto - padB}
                stroke="var(--kb-text-muted)"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <circle
                cx={coordX(hoverIndex)}
                cy={coordY(puntos[hoverIndex].acumulado)}
                r="4.5"
                fill={colorLinea}
                stroke="var(--kb-surface)"
                strokeWidth="2"
              />
            </>
          )}
        </svg>

        {/* Etiquetas del eje Y (HTML, no SVG, para que el texto no se deforme) */}
        {etiquetasEje.map((v) => (
          <span
            key={v}
            className="pointer-events-none absolute -translate-y-1/2 text-[11px] text-kb-text-muted"
            style={{ left: 0, top: `${(coordY(v) / alto) * 100}%` }}
          >
            {formatEje(v)}
          </span>
        ))}

        {/* Etiquetas del eje X */}
        {ticksX.map((i) => (
          <span
            key={i}
            className="pointer-events-none absolute -translate-x-1/2 text-[11px] text-kb-text-muted"
            style={{ left: `${(coordX(i) / ancho) * 100}%`, bottom: 0 }}
          >
            {formatFechaCorta(puntos[i].fecha)}
          </span>
        ))}

        {/* Tooltip flotante */}
        {puntoHover && hoverIndex !== null && (
          <div
            className="pointer-events-none absolute z-10 min-w-[140px] -translate-x-1/2 -translate-y-[calc(100%+12px)] rounded-lg border border-kb-border bg-kb-surface-raised px-3 py-2 text-xs shadow-xl"
            style={{
              left: `${(coordX(hoverIndex) / ancho) * 100}%`,
              top: `${(coordY(puntoHover.acumulado) / alto) * 100}%`,
            }}
          >
            <p className="mb-1 text-kb-text-muted">{formatFechaCorta(puntoHover.fecha)}</p>
            <p className="font-mono font-semibold text-kb-text">
              Equity: {formatCurrency(puntoHover.acumulado)}
            </p>
            <p className={`font-mono ${puntoHover.pnlTrade >= 0 ? "text-kb-gain" : "text-kb-loss"}`}>
              Trade: {puntoHover.pnlTrade >= 0 ? "+" : ""}
              {formatCurrency(puntoHover.pnlTrade)}
            </p>
            <p className="text-kb-text-secondary">{puntoHover.symbol}</p>
          </div>
        )}
      </div>
    </section>
  );
}

// =====================================================================
// RESUMEN DE RENDIMIENTO POR ESTRATEGIA
// =====================================================================

function ResumenPorEstrategia({
  trades,
  estrategias,
}: {
  trades: Trade[];
  estrategias: Strategy[];
}) {
  const filas = useMemo(() => {
    const cerrados = trades.filter((t) => t.status === "closed" && t.realized_pnl !== null);

    const grupos = new Map<string, { pnl: number; total: number; ganadores: number }>();
    grupos.set("sin_estrategia", { pnl: 0, total: 0, ganadores: 0 });
    estrategias.forEach((e) => grupos.set(e.id, { pnl: 0, total: 0, ganadores: 0 }));

    cerrados.forEach((t) => {
      const clave = t.strategy_id ?? "sin_estrategia";
      const actual = grupos.get(clave) ?? { pnl: 0, total: 0, ganadores: 0 };
      actual.pnl += t.realized_pnl ?? 0;
      actual.total += 1;
      if ((t.realized_pnl ?? 0) > 0) actual.ganadores += 1;
      grupos.set(clave, actual);
    });

    return Array.from(grupos.entries())
      .map(([clave, datos]) => ({
        nombre:
          clave === "sin_estrategia"
            ? "Sin estrategia"
            : estrategias.find((e) => e.id === clave)?.name ?? "—",
        ...datos,
        winRate: datos.total > 0 ? (datos.ganadores / datos.total) * 100 : 0,
      }))
      .filter((f) => f.total > 0)
      .sort((a, b) => b.pnl - a.pnl);
  }, [trades, estrategias]);

  return (
    <section className="rounded-xl border border-kb-border bg-kb-surface">
      <div className="border-b border-kb-border-soft px-5 py-4">
        <h2 className="font-display text-lg font-semibold">Rendimiento por estrategia</h2>
      </div>

      {filas.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-kb-text-secondary">
          Cierra operaciones con una estrategia asignada para ver tu rendimiento por setup.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-kb-border-soft text-xs text-kb-text-secondary">
                <th className="px-5 py-3 font-medium">Estrategia</th>
                <th className="px-5 py-3 font-medium">Operaciones</th>
                <th className="px-5 py-3 font-medium">Win rate</th>
                <th className="px-5 py-3 font-medium">P&amp;L total</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.nombre} className="border-b border-kb-border-soft">
                  <td className="px-5 py-3 font-medium">{f.nombre}</td>
                  <td className="px-5 py-3 font-mono text-kb-text-secondary">{f.total}</td>
                  <td className="px-5 py-3 font-mono">
                    <span className={f.winRate >= 50 ? "text-kb-gain" : "text-kb-loss"}>
                      {f.winRate.toFixed(0)}%
                    </span>
                  </td>
                  <td
                    className={`px-5 py-3 font-mono font-semibold ${
                      f.pnl >= 0 ? "text-kb-gain" : "text-kb-loss"
                    }`}
                  >
                    {formatCurrency(f.pnl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// =====================================================================
// PANEL DE MÉTRICAS PRINCIPAL — donut de win rate + P&L + barra de
// ganancia/pérdida promedio + extremos (estilo TradeLog)
// =====================================================================

function DonutWinRate({ winRate, totalTrades }: { winRate: number; totalTrades: number }) {
  const tamaño = 136;
  const grosor = 15;
  const radio = (tamaño - grosor) / 2;
  const circunferencia = 2 * Math.PI * radio;
  const porcionGanadora = (winRate / 100) * circunferencia;

  return (
    <div className="relative flex h-[136px] w-[136px] shrink-0 items-center justify-center">
      <svg viewBox={`0 0 ${tamaño} ${tamaño}`} className="h-full w-full -rotate-90">
        <circle
          cx={tamaño / 2}
          cy={tamaño / 2}
          r={radio}
          fill="none"
          stroke="var(--kb-loss)"
          strokeWidth={grosor}
          opacity="0.35"
        />
        <circle
          cx={tamaño / 2}
          cy={tamaño / 2}
          r={radio}
          fill="none"
          stroke="var(--kb-gain)"
          strokeWidth={grosor}
          strokeDasharray={`${porcionGanadora} ${circunferencia}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="font-mono text-2xl font-bold text-kb-text">{winRate.toFixed(1)}%</span>
        <span className="text-[9px] uppercase tracking-wide text-kb-text-secondary">Win rate</span>
        <span className="mt-0.5 text-[9px] text-kb-text-muted">{totalTrades} trades</span>
      </div>
    </div>
  );
}

// =====================================================================
// CHECKLIST DIARIO PRE-TRADING — refuerza disciplina antes de operar
// =====================================================================

function ChecklistDiarioWidget({
  items,
  completados,
  cargando,
  onToggle,
  onAgregar,
  onEliminar,
}: {
  items: ChecklistItem[];
  completados: Set<string>;
  cargando: boolean;
  onToggle: (itemId: string) => void;
  onAgregar: (texto: string) => void;
  onEliminar: (itemId: string) => void;
}) {
  const [nuevoItem, setNuevoItem] = useState("");
  const [mostrarForm, setMostrarForm] = useState(false);

  function handleAgregar(e: FormEvent) {
    e.preventDefault();
    const texto = nuevoItem.trim();
    if (!texto) return;
    onAgregar(texto);
    setNuevoItem("");
    setMostrarForm(false);
  }

  const completadosCount = items.filter((i) => completados.has(i.id)).length;

  if (cargando) {
    return (
      <section className="rounded-xl border border-kb-border bg-kb-surface p-4">
        <SkeletonBloque className="h-4 w-40 mb-3" />
        <SkeletonBloque className="h-8 w-full mb-2" />
        <SkeletonBloque className="h-8 w-full" />
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-kb-border bg-kb-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="font-display text-sm font-semibold">✅ Checklist de hoy</h2>
          {items.length > 0 && (
            <p className="text-[11px] text-kb-text-secondary">
              {completadosCount}/{items.length} completados
            </p>
          )}
        </div>
        <button
          onClick={() => setMostrarForm((v) => !v)}
          className="text-xs font-medium text-kb-accent hover:underline"
        >
          + Ítem
        </button>
      </div>

      {items.length === 0 && !mostrarForm ? (
        <p className="text-xs text-kb-text-secondary">
          Armá tu rutina pre-trading — ej. "¿Revisé noticias?", "¿Respeté mi plan de riesgo?".
          Click en "+ Ítem" para empezar.
        </p>
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => {
            const marcado = completados.has(item.id);
            return (
              <div
                key={item.id}
                className="group flex items-center justify-between rounded-lg border border-kb-border-soft bg-kb-bg px-3 py-2"
              >
                <button
                  onClick={() => onToggle(item.id)}
                  className="flex flex-1 items-center gap-2 text-left text-sm"
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      marcado ? "border-kb-gain bg-kb-gain text-kb-bg" : "border-kb-border"
                    }`}
                  >
                    {marcado && "✓"}
                  </span>
                  <span className={marcado ? "text-kb-text-muted line-through" : "text-kb-text"}>
                    {item.text}
                  </span>
                </button>
                <button
                  onClick={() => onEliminar(item.id)}
                  className="ml-2 text-xs text-kb-text-muted opacity-0 hover:text-kb-loss group-hover:opacity-100 transition-opacity"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      {mostrarForm && (
        <form onSubmit={handleAgregar} className="mt-2 flex gap-2">
          <input
            autoFocus
            value={nuevoItem}
            onChange={(e) => setNuevoItem(e.target.value)}
            placeholder="Ej. ¿Definí mi stop loss antes de entrar?"
            className={inputClass}
          />
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-kb-accent px-3 text-sm font-medium text-kb-bg hover:brightness-110 transition"
          >
            Agregar
          </button>
        </form>
      )}
    </section>
  );
}

function PanelMetricasPrincipal({
  metricas,
  etiquetaRacha,
}: {
  metricas: Metricas;
  etiquetaRacha: string;
}) {
  const totalPromedios = metricas.avgGanancia + metricas.avgPerdida || 1;
  const porcionGanancia = (metricas.avgGanancia / totalPromedios) * 100;

  return (
    <section className="grid gap-4 lg:grid-cols-[8fr_5fr]">
      {/* Tarjeta 1: Donut + P&L total + barra de promedios */}
      <div className="flex flex-col gap-5 rounded-xl border border-kb-border bg-kb-surface p-5 sm:flex-row sm:items-center">
        <DonutWinRate winRate={metricas.winRate} totalTrades={metricas.totalTrades} />

        <div className="flex-1 space-y-4">
          <div>
            <p className="text-xs uppercase leading-none tracking-wide text-kb-text-secondary">P&amp;L total</p>
            <p
              className={`mt-1 font-mono text-3xl font-bold leading-tight ${
                metricas.totalPnL >= 0 ? "text-kb-gain" : "text-kb-loss"
              }`}
            >
              {metricas.totalPnL >= 0 ? "+" : ""}
              {formatCurrency(metricas.totalPnL)}
            </p>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="text-kb-text-secondary">
                Avg ganancia{" "}
                <span className="font-mono font-semibold text-kb-gain">
                  +{formatCurrency(metricas.avgGanancia)}
                </span>
              </span>
              <span className="text-kb-text-secondary">
                Avg pérdida{" "}
                <span className="font-mono font-semibold text-kb-loss">
                  -{formatCurrency(metricas.avgPerdida)}
                </span>
              </span>
            </div>
            <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-kb-border">
              <div className="h-full bg-kb-gain" style={{ width: `${porcionGanancia}%` }} />
              <div className="h-full bg-kb-loss" style={{ width: `${100 - porcionGanancia}%` }} />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[11px] text-kb-text-muted">
              <span>{metricas.ganadoresCount} ganadoras</span>
              <span>{metricas.perdedoresCount} perdedoras</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tarjeta 2: lista con divisores horizontales, como en TradeLog */}
      <div className="divide-y divide-kb-border-soft rounded-xl border border-kb-border bg-kb-surface">
        <div className="px-5 py-4">
          <p className="text-xs uppercase leading-none tracking-wide text-kb-text-secondary">Mayor ganancia</p>
          <p
            className={`mt-1.5 font-mono text-2xl font-bold leading-tight ${
              metricas.mejorTrade > 0 ? "text-kb-gain" : "text-kb-text"
            }`}
          >
            {metricas.mejorTrade > 0 ? formatCurrency(metricas.mejorTrade) : "—"}
          </p>
        </div>
        <div className="px-5 py-4">
          <p className="text-xs uppercase leading-none tracking-wide text-kb-text-secondary">Mayor pérdida</p>
          <p
            className={`mt-1.5 font-mono text-2xl font-bold leading-tight ${
              metricas.peorTrade < 0 ? "text-kb-loss" : "text-kb-text"
            }`}
          >
            {metricas.peorTrade < 0 ? formatCurrency(metricas.peorTrade) : "—"}
          </p>
        </div>
        <div className="px-5 py-4">
          <p className="text-xs uppercase leading-none tracking-wide text-kb-text-secondary">Racha actual</p>
          <p
            className={`mt-1.5 font-mono text-2xl font-bold leading-tight ${
              metricas.tipoRacha === "ganadora"
                ? "text-kb-gain"
                : metricas.tipoRacha === "perdedora"
                ? "text-kb-loss"
                : "text-kb-text"
            }`}
          >
            {etiquetaRacha}
          </p>
        </div>
      </div>
    </section>
  );
}

// =====================================================================
// SKELETON LOADERS — placeholders animados mientras cargan los datos,
// en vez de texto plano "Cargando…"
// =====================================================================

function SkeletonBloque({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-kb-border-soft ${className}`} />;
}

function SkeletonFilas({ filas = 4 }: { filas?: number }) {
  return (
    <div className="divide-y divide-kb-border-soft">
      {Array.from({ length: filas }).map((_, i) => (
        <div key={i} className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <SkeletonBloque className="h-4 w-12" />
            <SkeletonBloque className="h-4 w-16" />
            <SkeletonBloque className="h-3 w-20" />
          </div>
          <SkeletonBloque className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

function SkeletonTabla({ filas = 5, columnas = 6 }: { filas?: number; columnas?: number }) {
  return (
    <div className="space-y-3 p-5">
      {Array.from({ length: filas }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: columnas }).map((_, j) => (
            <SkeletonBloque key={j} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

function SkeletonTarjetas({ cantidad = 3 }: { cantidad?: number }) {
  return (
    <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: cantidad }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-lg border border-kb-border-soft bg-kb-bg">
          <SkeletonBloque className="h-36 w-full rounded-none" />
          <div className="space-y-2 p-3">
            <SkeletonBloque className="h-4 w-3/4" />
            <SkeletonBloque className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Extrae la ruta relativa dentro de un bucket de Storage, sea que el
 * valor guardado ya sea una ruta simple o una URL pública vieja (de
 * antes de que los buckets se hicieran privados).
 */
function extraerRutaStorage(bucket: string, valor: string): string {
  if (!valor.startsWith("http")) return valor;
  const marcador = `/${bucket}/`;
  const indice = valor.indexOf(marcador);
  return indice === -1 ? valor : valor.slice(indice + marcador.length);
}

/**
 * Muestra una imagen de un bucket privado de Storage, generando una URL
 * firmada temporal (válida por 1 hora) en vez de depender de un link
 * público permanente.
 */
function ImagenPrivada({
  bucket,
  path,
  alt,
  className,
}: {
  bucket: string;
  path: string;
  alt: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    async function cargar() {
      const ruta = extraerRutaStorage(bucket, path);
      const { data } = await supabase.storage.from(bucket).createSignedUrl(ruta, 3600);
      if (activo) setUrl(data?.signedUrl ?? null);
    }
    cargar();
    return () => {
      activo = false;
    };
  }, [bucket, path]);

  if (!url) return <SkeletonBloque className={className ?? "h-full w-full"} />;

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className={className} />;
}

function MetricCard({
  etiqueta,
  valor,
  tono,
}: {
  etiqueta: string;
  valor: string;
  tono?: "gain" | "loss";
}) {
  const colorValor =
    tono === "gain" ? "text-kb-gain" : tono === "loss" ? "text-kb-loss" : "text-kb-text";
  const colorBarra =
    tono === "gain" ? "bg-kb-gain" : tono === "loss" ? "bg-kb-loss" : "bg-kb-accent";

  return (
    <div className="overflow-hidden rounded-xl border border-kb-border bg-kb-surface transition-all hover:-translate-y-0.5 hover:border-kb-border-soft hover:shadow-lg hover:shadow-black/20">
      <div className={`h-0.5 w-full ${colorBarra}`} />
      <div className="p-4">
        <p className="text-xs uppercase tracking-wide text-kb-text-secondary">{etiqueta}</p>
        <p className={`mt-1.5 font-mono text-2xl font-semibold ${colorValor}`}>{valor}</p>
      </div>
    </div>
  );
}

// =====================================================================
// CALENDARIO DE RENDIMIENTO — ancho completo, con monto por día y
// total semanal al costado de cada fila (como en TradeZella)
// =====================================================================

const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

interface ResumenDia {
  pnl: number;
  cantidadTrades: number;
}

type CeldaDia = { fecha: Date; clave: string } | null;

function CalendarioRendimiento({
  trades,
  estrategias,
  accountId,
  tieneCuentas,
  diaSeleccionado,
  onSeleccionarDia,
  onTradeActualizado,
}: {
  trades: Trade[];
  estrategias: Strategy[];
  accountId: string | null;
  tieneCuentas: boolean;
  diaSeleccionado: string;
  onSeleccionarDia: (clave: string) => void;
  onTradeActualizado: () => void;
}) {
  const [mesActual, setMesActual] = useState(() => {
    const hoy = new Date();
    return { year: hoy.getFullYear(), month: hoy.getMonth() };
  });
  const [diaConVarios, setDiaConVarios] = useState<{ clave: string; trades: Trade[] } | null>(null);
  const [tradeSeleccionado, setTradeSeleccionado] = useState<Trade | null>(null);
  const [diaParaCrear, setDiaParaCrear] = useState<string | null>(null);

  const resumenPorDia = useMemo(() => {
    const mapa = new Map<string, ResumenDia>();
    trades
      .filter((t) => t.status === "closed" && t.realized_pnl !== null)
      .forEach((t) => {
        const fecha = new Date(t.entry_time);
        const clave = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-${String(
          fecha.getDate()
        ).padStart(2, "0")}`;
        const previo = mapa.get(clave) ?? { pnl: 0, cantidadTrades: 0 };
        mapa.set(clave, {
          pnl: previo.pnl + (t.realized_pnl ?? 0),
          cantidadTrades: previo.cantidadTrades + 1,
        });
      });
    return mapa;
  }, [trades]);

  const diasConPendiente = useMemo(() => {
    const set = new Set<string>();
    trades
      .filter((t) => t.status === "open")
      .forEach((t) => set.add(t.entry_time.slice(0, 10)));
    return set;
  }, [trades]);

  const resumenDelMes = useMemo(() => {
    const { year, month } = mesActual;
    let pnl = 0;
    let diasOperados = 0;
    resumenPorDia.forEach((resumen, clave) => {
      const [y, m] = clave.split("-").map(Number);
      if (y === year && m === month + 1) {
        pnl += resumen.pnl;
        diasOperados += 1;
      }
    });
    return { pnl, diasOperados };
  }, [resumenPorDia, mesActual]);

  const semanas = useMemo(() => {
    const { year, month } = mesActual;
    const primerDia = new Date(year, month, 1);
    const ultimoDia = new Date(year, month + 1, 0);
    const offsetInicial = (primerDia.getDay() + 6) % 7;

    const celdas: CeldaDia[] = [];
    for (let i = 0; i < offsetInicial; i++) celdas.push(null);
    for (let d = 1; d <= ultimoDia.getDate(); d++) {
      const fecha = new Date(year, month, d);
      const clave = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      celdas.push({ fecha, clave });
    }
    while (celdas.length % 7 !== 0) celdas.push(null);

    const filas: CeldaDia[][] = [];
    for (let i = 0; i < celdas.length; i += 7) filas.push(celdas.slice(i, i + 7));
    return filas;
  }, [mesActual]);

  function cambiarMes(delta: number) {
    setMesActual((prev) => {
      const nuevaFecha = new Date(prev.year, prev.month + delta, 1);
      return { year: nuevaFecha.getFullYear(), month: nuevaFecha.getMonth() };
    });
  }

  // Si el día ya tiene operaciones registradas, mostramos el resumen en vez
  // de mandar directo al formulario de registro. Con 1 sola operación se
  // abre su detalle; con varias, primero hay que elegir cuál.
  function manejarClickDia(clave: string) {
    // Incluye tanto operaciones cerradas como pendientes de ese día, para
    // poder finalizar una pendiente con un clic desde el calendario.
    const tradesDelDia = trades.filter((t) => t.entry_time.slice(0, 10) === clave);
    if (tradesDelDia.length === 0) {
      onSeleccionarDia(clave);
      setDiaParaCrear(clave);
    } else {
      setDiaConVarios({ clave, trades: tradesDelDia });
    }
  }

  return (
    <section className="rounded-xl border border-kb-border bg-kb-surface p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-lg font-semibold">
            {MESES[mesActual.month]} {mesActual.year}
          </h2>
          <div className="flex gap-2">
            <button
              onClick={() => cambiarMes(-1)}
              aria-label="Mes anterior"
              className="rounded-lg border border-kb-border px-2.5 py-1 text-sm text-kb-text-secondary hover:border-kb-accent hover:text-kb-accent transition-colors"
            >
              ‹
            </button>
            <button
              onClick={() => cambiarMes(1)}
              aria-label="Mes siguiente"
              className="rounded-lg border border-kb-border px-2.5 py-1 text-sm text-kb-text-secondary hover:border-kb-accent hover:text-kb-accent transition-colors"
            >
              ›
            </button>
          </div>
        </div>

        {resumenDelMes.diasOperados > 0 && (
          <div className="flex items-center gap-4 text-sm">
            <span className="text-kb-text-secondary">
              {resumenDelMes.diasOperados} día{resumenDelMes.diasOperados === 1 ? "" : "s"} operado
              {resumenDelMes.diasOperados === 1 ? "" : "s"}
            </span>
            <span
              className={`font-mono font-semibold ${
                resumenDelMes.pnl >= 0 ? "text-kb-gain" : "text-kb-loss"
              }`}
            >
              {resumenDelMes.pnl >= 0 ? "+" : ""}
              {formatCurrency(resumenDelMes.pnl)}
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-[repeat(7,1fr)_auto] gap-2 text-center text-xs text-kb-text-muted mb-2">
        {DIAS_SEMANA.map((d) => (
          <span key={d}>{d}</span>
        ))}
        <span className="w-20">Semana</span>
      </div>

      <div className="space-y-2">
        {semanas.map((semana, filaIdx) => {
          const totalSemana = semana.reduce((acc, celda) => {
            if (!celda) return acc;
            const resumen = resumenPorDia.get(celda.clave);
            return acc + (resumen?.pnl ?? 0);
          }, 0);
          const semanaTuvoOperaciones = semana.some(
            (celda) => celda && resumenPorDia.has(celda.clave)
          );

          return (
            <div key={filaIdx} className="grid grid-cols-[repeat(7,1fr)_auto] gap-2">
              {semana.map((celda, i) => {
                if (!celda) return <div key={`vacio-${filaIdx}-${i}`} />;

                const resumen = resumenPorDia.get(celda.clave);
                const tienePendiente = diasConPendiente.has(celda.clave);
                const esHoy = celda.clave === todayKey();
                const seleccionado = diaSeleccionado === celda.clave;

                let estiloCelda = "border-kb-border-soft bg-kb-bg text-kb-text-secondary";
                if (resumen) {
                  estiloCelda =
                    resumen.pnl >= 0
                      ? "border-kb-gain/30 bg-kb-gain/10 text-kb-gain"
                      : "border-kb-loss/30 bg-kb-loss/10 text-kb-loss";
                } else if (tienePendiente) {
                  estiloCelda = "border-kb-accent/40 bg-kb-accent/10 text-kb-accent";
                }

                return (
                  <button
                    key={celda.clave}
                    type="button"
                    onClick={() => manejarClickDia(celda.clave)}
                    className={`relative h-16 rounded-lg border p-1.5 text-left transition-colors cursor-pointer hover:brightness-125 sm:h-20 ${estiloCelda} ${
                      seleccionado ? "ring-2 ring-kb-accent" : ""
                    } ${esHoy ? "outline outline-1 outline-kb-accent/50" : ""}`}
                  >
                    {tienePendiente && <span className="absolute right-1 top-1 text-xs">🕐</span>}
                    <span className="block text-[11px] font-medium">{celda.fecha.getDate()}</span>
                    {resumen && (
                      <span className="mt-1 block font-mono text-[10px] font-semibold leading-tight">
                        {resumen.pnl >= 0 ? "+" : ""}
                        {formatCurrency(resumen.pnl)}
                      </span>
                    )}
                    {resumen && resumen.cantidadTrades > 1 && (
                      <span className="mt-0.5 block text-[9px] text-kb-text-muted">
                        {resumen.cantidadTrades} ops
                      </span>
                    )}
                  </button>
                );
              })}

              <div
                className={`flex h-16 w-20 flex-col items-center justify-center rounded-lg border text-center sm:h-20 ${
                  !semanaTuvoOperaciones
                    ? "border-kb-border-soft bg-kb-bg/40"
                    : totalSemana >= 0
                    ? "border-kb-gain/20 bg-kb-gain/5"
                    : "border-kb-loss/20 bg-kb-loss/5"
                }`}
              >
                {semanaTuvoOperaciones ? (
                  <span
                    className={`font-mono text-xs font-semibold ${
                      totalSemana >= 0 ? "text-kb-gain" : "text-kb-loss"
                    }`}
                  >
                    {totalSemana >= 0 ? "+" : ""}
                    {formatCurrency(totalSemana)}
                  </span>
                ) : (
                  <span className="text-xs text-kb-text-muted">—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-center text-xs text-kb-text-secondary">
        Haz clic en un día para registrar o revisar operaciones de esa fecha.
      </p>

      {resumenPorDia.size === 0 && (
        <p className="mt-2 text-center text-sm text-kb-text-secondary">
          Cierra operaciones para ver tu rendimiento diario reflejado aquí.
        </p>
      )}

      {diaConVarios && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-kb-border bg-kb-surface p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">
                {new Date(diaConVarios.clave + "T00:00:00").toLocaleDateString("es-ES", {
                  day: "numeric",
                  month: "long",
                })}
              </h3>
              <button
                onClick={() => setDiaConVarios(null)}
                className="text-kb-text-muted hover:text-kb-text transition"
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>
            <p className="mb-3 text-xs text-kb-text-secondary">
              Este día tenés {diaConVarios.trades.length} operación{diaConVarios.trades.length === 1 ? "" : "es"} registrada{diaConVarios.trades.length === 1 ? "" : "s"}.
            </p>
            <div className="space-y-2">
              {diaConVarios.trades.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setTradeSeleccionado(t);
                    setDiaConVarios(null);
                  }}
                  className="flex w-full items-center justify-between rounded-lg border border-kb-border-soft bg-kb-bg px-3 py-2.5 text-left hover:border-kb-accent transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        t.side === "long" ? "bg-kb-gain/10 text-kb-gain" : "bg-kb-loss/10 text-kb-loss"
                      }`}
                    >
                      {t.side === "long" ? "Long" : "Short"}
                    </span>
                    <span className="font-mono text-sm font-semibold">{t.symbol}</span>
                  </span>
                  <span
                    className={`font-mono text-sm font-semibold ${
                      (t.realized_pnl ?? 0) >= 0 ? "text-kb-gain" : "text-kb-loss"
                    }`}
                  >
                    {t.realized_pnl === null ? "—" : formatCurrency(t.realized_pnl)}
                  </span>
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                setDiaParaCrear(diaConVarios.clave);
                setDiaConVarios(null);
              }}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-kb-accent/40 px-3 py-2.5 text-sm font-medium text-kb-accent hover:bg-kb-accent/10 transition-colors"
            >
              + Agregar otra operación
            </button>
          </div>
        </div>
      )}

      {tradeSeleccionado && (
        <ModalDetalleTrade
          trade={tradeSeleccionado}
          estrategias={estrategias}
          onClose={() => setTradeSeleccionado(null)}
          onActualizado={() => {
            setTradeSeleccionado(null);
            onTradeActualizado();
          }}
          onEliminado={() => {
            setTradeSeleccionado(null);
            onTradeActualizado();
          }}
        />
      )}

      {diaParaCrear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 overflow-y-auto">
          <div className="w-full max-h-[85vh] max-w-2xl overflow-y-auto rounded-2xl border border-kb-border bg-kb-surface p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">
                Registrar operación —{" "}
                {new Date(diaParaCrear + "T00:00:00").toLocaleDateString("es-ES", {
                  day: "numeric",
                  month: "long",
                })}
              </h3>
              <button
                onClick={() => setDiaParaCrear(null)}
                className="text-kb-text-muted hover:text-kb-text transition"
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>
            <FormularioTrade
              accountId={accountId}
              tieneCuentas={tieneCuentas}
              diaParaRegistrar={diaParaCrear}
              estrategiasDisponibles={estrategias}
              onTradeCreado={() => {
                setDiaParaCrear(null);
                onTradeActualizado();
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}

// =====================================================================
// FORMULARIO: registrar nueva operación
// =====================================================================

function FormularioTrade({
  accountId,
  tieneCuentas,
  diaParaRegistrar,
  estrategiasDisponibles,
  onTradeCreado,
}: {
  accountId: string | null;
  tieneCuentas: boolean;
  diaParaRegistrar: string;
  estrategiasDisponibles: Strategy[];
  onTradeCreado: () => void;
}) {
  const [symbol, setSymbol] = useState("");
  const [instrumentType, setInstrumentType] = useState<InstrumentType>("stock");
  const [side, setSide] = useState<TradeSide>("long");
  const [yaSeCerro, setYaSeCerro] = useState(true);
  const [resultType, setResultType] = useState<ResultType>("tp");
  const [quantity, setQuantity] = useState("");
  const [entryPrice, setEntryPrice] = useState("");
  const [exitPrice, setExitPrice] = useState("");
  const [pips, setPips] = useState("");
  const [fees, setFees] = useState("0");
  const [pnlManual, setPnlManual] = useState("");
  const [riskAmount, setRiskAmount] = useState("");
  const [session, setSession] = useState<TradingSession | "">("");
  const [entryTime, setEntryTime] = useState("");
  const [exitTime, setExitTime] = useState("");
  const [tradingviewLinks, setTradingviewLinks] = useState<string[]>([""]);
  const [notes, setNotes] = useState("");
  const [strategyId, setStrategyId] = useState<string>("");
  const [emotion, setEmotion] = useState<EmotionType | "">("");
  const [mistake, setMistake] = useState<MistakeType>("ninguno");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [estrategias, setEstrategias] = useState<Strategy[]>(estrategiasDisponibles);
  const [mostrarNuevaEstrategia, setMostrarNuevaEstrategia] = useState(false);
  const [nombreNuevaEstrategia, setNombreNuevaEstrategia] = useState("");
  const [guardandoEstrategia, setGuardandoEstrategia] = useState(false);

  useEffect(() => {
    setEstrategias(estrategiasDisponibles);
  }, [estrategiasDisponibles]);

  async function crearEstrategia() {
    const nombre = nombreNuevaEstrategia.trim();
    if (!nombre) return;

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;

    setGuardandoEstrategia(true);
    const { data, error: insertError } = await supabase
      .from("strategies")
      .insert({ user_id: userId, name: nombre })
      .select()
      .single();
    setGuardandoEstrategia(false);

    if (!insertError && data) {
      setEstrategias((prev) => [...prev, data as Strategy]);
      setStrategyId((data as Strategy).id);
      setNombreNuevaEstrategia("");
      setMostrarNuevaEstrategia(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!accountId) {
      setError("Crea una cuenta primero para poder registrar operaciones en ella.");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setError("Tu sesión expiró. Vuelve a iniciar sesión.");
      return;
    }

    const cantidad = parseFloat(quantity);
    const precioEntrada = parseFloat(entryPrice);
    const precioSalida = yaSeCerro ? parseFloat(exitPrice) : null;
    const comisiones = parseFloat(fees || "0");
    const pnlNumero = yaSeCerro ? parseFloat(pnlManual) : null;
    const pipsNumero = pips.trim() === "" ? null : parseFloat(pips);

    if (
      Number.isNaN(cantidad) ||
      Number.isNaN(precioEntrada) ||
      (yaSeCerro && (precioSalida === null || Number.isNaN(precioSalida))) ||
      (yaSeCerro && (pnlNumero === null || Number.isNaN(pnlNumero)))
    ) {
      setError(
        yaSeCerro
          ? "Cantidad, precio de entrada, precio de salida y resultado (P&L) son obligatorios y deben ser números."
          : "Cantidad y precio de entrada son obligatorios y deben ser números."
      );
      return;
    }

    setEnviando(true);

    const horaActual = new Date().toTimeString().slice(0, 5);
    const horaEntradaFinal = entryTime === "" ? horaActual : entryTime;
    const horaSalidaFinal = exitTime === "" ? horaActual : exitTime;

    const entryTimestamp = new Date(`${diaParaRegistrar}T${horaEntradaFinal}:00`).toISOString();
    const exitTimestamp = yaSeCerro
      ? new Date(`${diaParaRegistrar}T${horaSalidaFinal}:00`).toISOString()
      : null;

    const { error: insertError } = await conReintento(() =>
      supabase.from("trades").insert({
        user_id: userId,
        account_id: accountId,
        symbol: symbol.trim().toUpperCase(),
        instrument_type: instrumentType,
        side,
        status: yaSeCerro ? "closed" : "open",
        quantity: cantidad,
        entry_price: precioEntrada,
        exit_price: precioSalida,
        fees: comisiones,
        realized_pnl: yaSeCerro && pnlNumero !== null ? Math.round((pnlNumero - comisiones) * 100) / 100 : null,
        result_type: yaSeCerro ? resultType : null,
        pips: yaSeCerro ? pipsNumero : null,
        session: session === "" ? null : session,
        tradingview_links: tradingviewLinks.map((l) => l.trim()).filter((l) => l !== ""),
        notes: notes.trim() === "" ? null : notes.trim(),
        strategy_id: strategyId === "" ? null : strategyId,
        emotion: emotion === "" ? null : emotion,
        mistake,
        risk_amount: riskAmount.trim() === "" ? null : parseFloat(riskAmount),
        entry_time: entryTimestamp,
        exit_time: exitTimestamp,
      })
    );

    setEnviando(false);

    if (insertError) {
      setError(
        `No se pudo guardar la operación (lo intentamos dos veces). Revisa tu conexión a internet e intenta de nuevo. Detalle: ${insertError.message}`
      );
      return;
    }

    setSymbol("");
    setQuantity("");
    setEntryPrice("");
    setExitPrice("");
    setPips("");
    setFees("0");
    setPnlManual("");
    setRiskAmount("");
    setSession("");
    setEntryTime("");
    setExitTime("");
    setTradingviewLinks([""]);
    setNotes("");
    setResultType("tp");
    setStrategyId("");
    setEmotion("");
    setMistake("ninguno");
    setYaSeCerro(true);
    onTradeCreado();
  }

  return (
    <section className="rounded-xl border border-kb-border bg-kb-surface p-5">
      <h2 className="font-display text-lg font-semibold mb-1">Registrar nueva operación</h2>
      <p className="mb-4 text-sm text-kb-text-secondary">
        Escribe el resultado bruto (P&amp;L) que viste en tu plataforma. La comisión que
        ingreses abajo se resta automáticamente para calcular tu P&amp;L neto final.
      </p>

      <div className="mb-5 flex gap-2">
        <button
          type="button"
          onClick={() => setYaSeCerro(true)}
          className={`flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
            yaSeCerro
              ? "border-kb-accent bg-kb-accent/10 text-kb-accent"
              : "border-kb-border text-kb-text-secondary hover:border-kb-text-secondary"
          }`}
        >
          ✅ Ya se cerró
        </button>
        <button
          type="button"
          onClick={() => setYaSeCerro(false)}
          className={`flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
            !yaSeCerro
              ? "border-kb-accent bg-kb-accent/10 text-kb-accent"
              : "border-kb-border text-kb-text-secondary hover:border-kb-text-secondary"
          }`}
        >
          🕐 Dejar pendiente
        </button>
      </div>

      {!yaSeCerro && (
        <p className="mb-5 rounded-lg border border-kb-accent/30 bg-kb-accent/10 px-3 py-2 text-xs text-kb-accent">
          La vas a poder cerrar después desde el Historial, eligiendo si dio Take Profit o Stop
          Loss y con un clic.
        </p>
      )}

      {!tieneCuentas && (
        <p className="mb-5 rounded-lg border border-kb-accent/30 bg-kb-accent/10 px-3 py-2 text-xs text-kb-accent">
          Primero crea una cuenta (botón &quot;+ Nueva cuenta&quot; arriba) para poder
          registrar operaciones en ella.
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* ---------- Sección 1: qué operaste ---------- */}
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-kb-accent">
            1. ¿Qué operaste?
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo etiqueta="Símbolo" ayuda="El ticker del activo, ej. AAPL, BTC, USDCAD">
              <input
                required
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="AAPL"
                className={inputClass}
              />
            </Campo>

            <Campo etiqueta="Instrumento" ayuda="Qué tipo de activo es">
              <select
                value={instrumentType}
                onChange={(e) => setInstrumentType(e.target.value as InstrumentType)}
                className={inputClass}
              >
                {Object.entries(INSTRUMENT_LABELS).map(([valor, etiqueta]) => (
                  <option key={valor} value={valor}>
                    {etiqueta}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo etiqueta="Dirección" ayuda="Long = compraste. Short = vendiste en corto">
              <select
                value={side}
                onChange={(e) => setSide(e.target.value as TradeSide)}
                className={inputClass}
              >
                <option value="long">Long (compra)</option>
                <option value="short">Short (venta en corto)</option>
              </select>
            </Campo>
          </div>
        </div>

        {/* ---------- Sección 2: precios y resultado numérico ---------- */}
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-kb-accent">
            2. Precios, lotaje y resultado
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo
              etiqueta={instrumentType === "forex" ? "Lotes" : "Cantidad"}
              ayuda={
                instrumentType === "forex"
                  ? "Tamaño de la posición en lotes, ej. 1.66"
                  : "Unidades operadas: acciones, lotes o monto"
              }
            >
              <input
                required
                type="number"
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder={instrumentType === "forex" ? "1.66" : "100"}
                className={inputClass}
              />
            </Campo>

            <Campo etiqueta="Precio de entrada" ayuda="A cuánto entraste al mercado">
              <input
                required
                type="number"
                step="any"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
                placeholder="150.25"
                className={inputClass}
              />
            </Campo>

            {yaSeCerro && (
              <>
                <Campo etiqueta="Precio de salida" ayuda="A cuánto saliste, en tu TP o tu SL">
                  <input
                    required
                    type="number"
                    step="any"
                    value={exitPrice}
                    onChange={(e) => setExitPrice(e.target.value)}
                    placeholder="155.80"
                    className={inputClass}
                  />
                </Campo>

                <Campo etiqueta="Pips (opcional)" ayuda="Los pips que viste en tu plataforma">
                  <input
                    type="number"
                    step="any"
                    value={pips}
                    onChange={(e) => setPips(e.target.value)}
                    placeholder="12"
                    className={inputClass}
                  />
                </Campo>

                <Campo etiqueta="Comisión" ayuda="Lo que te cobró tu bróker o empresa">
                  <input
                    type="number"
                    step="any"
                    value={fees}
                    onChange={(e) => setFees(e.target.value)}
                    className={inputClass}
                  />
                </Campo>

                <Campo
                  etiqueta="P&L (ganancia o pérdida)"
                  ayuda="El resultado bruto en dólares (sin restar la comisión — eso lo hacemos nosotros solos)"
                >
                  <input
                    required
                    type="number"
                    step="any"
                    value={pnlManual}
                    onChange={(e) => setPnlManual(e.target.value)}
                    placeholder="200 o -50"
                    className={inputClass}
                  />
                </Campo>
              </>
            )}

            <Campo
              etiqueta="Monto arriesgado (opcional)"
              ayuda="Cuánto ibas a perder si tocaba tu stop loss — sirve para calcular tu R-múltiplo"
            >
              <input
                type="number"
                step="any"
                value={riskAmount}
                onChange={(e) => setRiskAmount(e.target.value)}
                placeholder="Ej. 100"
                className={inputClass}
              />
            </Campo>
          </div>
        </div>

        {/* ---------- Sección 3: sesión, horas y evidencia ---------- */}
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-kb-accent">
            3. Sesión, horario y evidencia
          </p>
          <p className="mb-3 text-xs text-kb-text-secondary">
            Esta operación se registrará para el día{" "}
            <span className="font-semibold text-kb-accent">
              {new Date(diaParaRegistrar + "T00:00:00").toLocaleDateString("es-ES", {
                day: "numeric",
                month: "long",
              })}
            </span>{" "}
            (cámbialo desde el calendario en Inicio si quieres otra fecha).
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo etiqueta="Sesión (opcional)" ayuda="¿En qué sesión de mercado operaste?">
              <select
                value={session}
                onChange={(e) => setSession(e.target.value as TradingSession | "")}
                className={inputClass}
              >
                <option value="">Sin especificar</option>
                {Object.entries(SESSION_LABELS).map(([valor, etiqueta]) => (
                  <option key={valor} value={valor}>
                    {etiqueta}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo etiqueta="Hora de entrada (opcional)" ayuda="Si no la pones, se usa la hora actual">
              <input
                type="time"
                value={entryTime}
                onChange={(e) => setEntryTime(e.target.value)}
                className={inputClass}
              />
            </Campo>

            <Campo etiqueta="Hora de salida (opcional)" ayuda="Si no la pones, se usa la hora actual">
              <input
                type="time"
                value={exitTime}
                onChange={(e) => setExitTime(e.target.value)}
                className={inputClass}
              />
            </Campo>
          </div>

          <div className="mt-4">
            <span className="mb-1 block text-xs font-medium text-kb-text-secondary">
              Links de TradingView (opcional)
            </span>
            <span className="mb-2 block text-[11px] text-kb-text-muted">
              Pegá uno o varios links como evidencia — útil si querés mostrar distintas
              temporalidades del mismo gráfico.
            </span>
            <div className="space-y-2">
              {tradingviewLinks.map((link, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="url"
                    value={link}
                    onChange={(e) =>
                      setTradingviewLinks((prev) => prev.map((l, idx) => (idx === i ? e.target.value : l)))
                    }
                    placeholder={i === 0 ? "https://www.tradingview.com/x/..." : "Otra temporalidad…"}
                    className={inputClass}
                  />
                  {tradingviewLinks.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setTradingviewLinks((prev) => prev.filter((_, idx) => idx !== i))}
                      className="shrink-0 rounded-lg border border-kb-border px-3 text-sm text-kb-text-secondary hover:border-kb-loss hover:text-kb-loss transition-colors"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setTradingviewLinks((prev) => [...prev, ""])}
              className="mt-2 text-xs font-medium text-kb-accent hover:underline"
            >
              + Agregar otro link
            </button>
          </div>
        </div>

        {/* ---------- Sección 4: resultado y estrategia ---------- */}
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-kb-accent">
            4. {yaSeCerro ? "Resultado y estrategia" : "Estrategia"}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {yaSeCerro && (
              <Campo etiqueta="Resultado" ayuda="¿Cómo terminó la operación?">
                <select
                  value={resultType}
                  onChange={(e) => setResultType(e.target.value as ResultType)}
                  className={inputClass}
                >
                  {Object.entries(RESULT_LABELS).map(([valor, etiqueta]) => (
                    <option key={valor} value={valor}>
                      {etiqueta}
                    </option>
                  ))}
                </select>
              </Campo>
            )}

            <Campo etiqueta="Estrategia (opcional)" ayuda="Para filtrar y comparar luego tu rendimiento por setup">
              {!mostrarNuevaEstrategia ? (
                <div className="flex gap-2">
                  <select
                    value={strategyId}
                    onChange={(e) => setStrategyId(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">Sin estrategia</option>
                    {estrategias.map((est) => (
                      <option key={est.id} value={est.id}>
                        {est.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setMostrarNuevaEstrategia(true)}
                    className="shrink-0 rounded-lg border border-kb-border px-3 text-sm text-kb-text-secondary hover:border-kb-accent hover:text-kb-accent transition-colors"
                  >
                    + Nueva
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    autoFocus
                    value={nombreNuevaEstrategia}
                    onChange={(e) => setNombreNuevaEstrategia(e.target.value)}
                    placeholder="Ej. Breakout, Soporte/Resistencia…"
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={crearEstrategia}
                    disabled={guardandoEstrategia}
                    className="shrink-0 rounded-lg bg-kb-accent px-3 text-sm font-medium text-kb-bg hover:brightness-110 transition disabled:opacity-60"
                  >
                    Crear
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMostrarNuevaEstrategia(false);
                      setNombreNuevaEstrategia("");
                    }}
                    className="shrink-0 rounded-lg border border-kb-border px-3 text-sm text-kb-text-secondary hover:text-kb-text transition-colors"
                  >
                    ✕
                  </button>
                </div>
              )}
            </Campo>
          </div>
        </div>

        {/* ---------- Sección 5: psicología (emoción y error) ---------- */}
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-kb-accent">
            5. Psicología de la operación
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="¿Cómo te sentiste? (opcional)" ayuda="Tu estado emocional al operar">
              <select
                value={emotion}
                onChange={(e) => setEmotion(e.target.value as EmotionType | "")}
                className={inputClass}
              >
                <option value="">Sin especificar</option>
                {Object.entries(EMOTION_LABELS).map(([valor, etiqueta]) => (
                  <option key={valor} value={valor}>
                    {EMOTION_EMOJI[valor as EmotionType]} {etiqueta}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo etiqueta="¿Cometiste algún error?" ayuda="Para detectar patrones que se repiten">
              <select
                value={mistake}
                onChange={(e) => setMistake(e.target.value as MistakeType)}
                className={inputClass}
              >
                {Object.entries(MISTAKE_LABELS).map(([valor, etiqueta]) => (
                  <option key={valor} value={valor}>
                    {etiqueta}
                  </option>
                ))}
              </select>
            </Campo>
          </div>
        </div>

        {/* ---------- Sección 6: reflexión / journal ---------- */}
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-kb-accent">
            6. Tu diario de esta operación
          </p>
          <Campo
            etiqueta="Notas"
            ayuda="¿Por qué entraste? ¿Seguiste tu plan? ¿Qué aprenderías para la próxima?"
          >
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej: Rompió resistencia de 150 con volumen alto. Respeté mi stop loss. La próxima vez esperaría confirmación de cierre de vela antes de entrar."
              rows={4}
              className={`${inputClass} resize-none`}
            />
          </Campo>
        </div>

        {error && (
          <p className="rounded-lg border border-kb-loss/30 bg-kb-loss/10 px-3 py-2 text-xs text-kb-loss">
            {error}
          </p>
        )}

        <div>
          <button
            type="submit"
            disabled={enviando}
            className="rounded-lg bg-kb-accent px-5 py-2.5 text-sm font-semibold text-kb-bg hover:brightness-110 transition disabled:opacity-60"
          >
            {enviando ? "Guardando…" : "Guardar operación"}
          </button>
        </div>
      </form>
    </section>
  );
}

const inputClass =
  "w-full rounded-lg border border-kb-border bg-kb-bg px-3 py-2 text-sm text-kb-text outline-none focus:border-kb-accent";

function Campo({
  etiqueta,
  ayuda,
  children,
}: {
  etiqueta: string;
  ayuda?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-kb-text-secondary">{etiqueta}</span>
      {children}
      {ayuda && <span className="mt-1 block text-[11px] text-kb-text-muted">{ayuda}</span>}
    </label>
  );
}

// =====================================================================
// TABLA: historial de operaciones con P&L
// =====================================================================

// =====================================================================
// MODAL: detalle de un trade — ver, editar y eliminar
// =====================================================================

function ModalDetalleTrade({
  trade,
  estrategias,
  onClose,
  onActualizado,
  onEliminado,
}: {
  trade: Trade;
  estrategias: Strategy[];
  onClose: () => void;
  onActualizado: () => void;
  onEliminado: () => void;
}) {
  const [modo, setModo] = useState<"ver" | "editar" | "cerrar">("ver");
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false);
  const [procesando, setProcesando] = useState(false);

  async function eliminar() {
    setProcesando(true);
    const { error } = await supabase.from("trades").delete().eq("id", trade.id);
    setProcesando(false);
    if (!error) onEliminado();
  }

  const rMultiple = calcularRMultiple(trade.realized_pnl, trade.risk_amount);
  const estrategiaNombre = estrategias.find((e) => e.id === trade.strategy_id)?.name ?? "Sin estrategia";
  const estaPendiente = trade.status === "open";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 overflow-y-auto">
      <div className="w-full max-h-[85vh] max-w-lg overflow-y-auto rounded-2xl border border-kb-border bg-kb-surface p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl font-bold">{trade.symbol}</h2>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                trade.side === "long" ? "bg-kb-gain/10 text-kb-gain" : "bg-kb-loss/10 text-kb-loss"
              }`}
            >
              {trade.side === "long" ? "Long" : "Short"}
            </span>
            {estaPendiente && (
              <span className="rounded-full bg-kb-accent/10 px-2 py-0.5 text-xs font-medium text-kb-accent">
                🕐 Pendiente
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-kb-text-muted hover:text-kb-text transition" aria-label="Cerrar">
            ✕
          </button>
        </div>

        {modo === "cerrar" ? (
          <FormularioCerrarTrade
            trade={trade}
            onCancelar={() => setModo("ver")}
            onCerrado={onActualizado}
          />
        ) : modo === "ver" && estaPendiente ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-dashed border-kb-accent/40 bg-kb-accent/10 p-4 text-center">
              <p className="text-sm font-medium text-kb-accent">
                Esta operación todavía está abierta — registrala como cerrada cuando termine.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <DatoDetalle etiqueta="Instrumento" valor={INSTRUMENT_LABELS[trade.instrument_type]} />
              <DatoDetalle etiqueta="Cantidad" valor={String(trade.quantity)} />
              <DatoDetalle etiqueta="Entrada" valor={formatPrice(trade.entry_price)} />
              <DatoDetalle etiqueta="Sesión" valor={trade.session ? SESSION_LABELS[trade.session] : "—"} />
              <DatoDetalle etiqueta="Estrategia" valor={estrategiaNombre} />
              <DatoDetalle
                etiqueta="Emoción al entrar"
                valor={trade.emotion ? `${EMOTION_EMOJI[trade.emotion]} ${EMOTION_LABELS[trade.emotion]}` : "—"}
              />
              <DatoDetalle etiqueta="Fecha de entrada" valor={formatDate(trade.entry_time)} />
              <DatoDetalle
                etiqueta="Riesgo"
                valor={trade.risk_amount !== null ? formatCurrency(trade.risk_amount) : "—"}
              />
            </div>

            {trade.notes && (
              <div>
                <p className="mb-1 text-xs font-medium text-kb-text-secondary">Notas</p>
                <p className="rounded-lg border border-kb-border-soft bg-kb-bg p-3 text-sm text-kb-text whitespace-pre-wrap">
                  {trade.notes}
                </p>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setModo("cerrar")}
                className="flex-1 rounded-lg bg-kb-accent py-2.5 text-sm font-semibold text-kb-bg hover:brightness-110 transition"
              >
                ✅ Cerrar operación
              </button>
              <button
                onClick={() => setConfirmandoEliminar(true)}
                className="rounded-lg border border-kb-loss/30 px-4 py-2.5 text-sm font-medium text-kb-loss hover:bg-kb-loss/10 transition-colors"
              >
                Eliminar
              </button>
            </div>
          </div>
        ) : modo === "ver" ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-kb-border-soft bg-kb-bg p-4 text-center">
              <p className="text-xs text-kb-text-secondary">Resultado</p>
              <p
                className={`font-mono text-3xl font-bold ${
                  (trade.realized_pnl ?? 0) >= 0 ? "text-kb-gain" : "text-kb-loss"
                }`}
              >
                {trade.realized_pnl === null ? "—" : formatCurrency(trade.realized_pnl)}
              </p>
              {rMultiple !== null && (
                <p className={`mt-1 font-mono text-sm ${rMultiple >= 0 ? "text-kb-gain" : "text-kb-loss"}`}>
                  {formatRMultiple(rMultiple)}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <DatoDetalle etiqueta="Instrumento" valor={INSTRUMENT_LABELS[trade.instrument_type]} />
              <DatoDetalle etiqueta="Cantidad" valor={String(trade.quantity)} />
              <DatoDetalle etiqueta="Entrada" valor={formatPrice(trade.entry_price)} />
              <DatoDetalle etiqueta="Salida" valor={trade.exit_price !== null ? formatPrice(trade.exit_price) : "—"} />
              <DatoDetalle etiqueta="Pips" valor={trade.pips !== null ? String(trade.pips) : "—"} />
              <DatoDetalle etiqueta="Resultado" valor={trade.result_type ? RESULT_LABELS[trade.result_type] : "—"} />
              <DatoDetalle etiqueta="Sesión" valor={trade.session ? SESSION_LABELS[trade.session] : "—"} />
              <DatoDetalle etiqueta="Estrategia" valor={estrategiaNombre} />
              <DatoDetalle
                etiqueta="Emoción"
                valor={trade.emotion ? `${EMOTION_EMOJI[trade.emotion]} ${EMOTION_LABELS[trade.emotion]}` : "—"}
              />
              <DatoDetalle
                etiqueta="Error"
                valor={trade.mistake && trade.mistake !== "ninguno" ? MISTAKE_LABELS[trade.mistake] : "Ninguno"}
              />
              <DatoDetalle etiqueta="Fecha" valor={formatDate(trade.entry_time)} />
              <DatoDetalle
                etiqueta="Riesgo"
                valor={trade.risk_amount !== null ? formatCurrency(trade.risk_amount) : "—"}
              />
            </div>

            {trade.notes && (
              <div>
                <p className="mb-1 text-xs font-medium text-kb-text-secondary">Notas</p>
                <p className="rounded-lg border border-kb-border-soft bg-kb-bg p-3 text-sm text-kb-text whitespace-pre-wrap">
                  {trade.notes}
                </p>
              </div>
            )}

            {trade.tradingview_links && trade.tradingview_links.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-kb-text-secondary">
                  Evidencia {trade.tradingview_links.length > 1 ? `(${trade.tradingview_links.length} temporalidades)` : ""}
                </p>
                <div className="flex flex-wrap gap-3">
                  {trade.tradingview_links.map((link, i) => (
                    <a
                      key={i}
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block text-sm text-kb-accent hover:underline"
                    >
                      Ver gráfico {trade.tradingview_links.length > 1 ? `#${i + 1}` : ""} →
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setModo("editar")}
                className="flex-1 rounded-lg border border-kb-border py-2.5 text-sm font-medium text-kb-text hover:border-kb-accent hover:text-kb-accent transition-colors"
              >
                Editar
              </button>
              <button
                onClick={() => setConfirmandoEliminar(true)}
                className="flex-1 rounded-lg border border-kb-loss/30 py-2.5 text-sm font-medium text-kb-loss hover:bg-kb-loss/10 transition-colors"
              >
                Eliminar
              </button>
            </div>
          </div>
        ) : (
          <FormularioEdicionTrade
            trade={trade}
            estrategias={estrategias}
            onCancelar={() => setModo("ver")}
            onGuardado={onActualizado}
          />
        )}

        {confirmandoEliminar && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
            <div className="w-full max-w-sm rounded-2xl border border-kb-border bg-kb-surface p-6 shadow-2xl">
              <h3 className="font-display text-lg font-bold text-kb-text">¿Eliminar esta operación?</h3>
              <p className="mt-2 text-sm text-kb-text-secondary">
                Esta acción no se puede deshacer. La operación de {trade.symbol} se borrará por completo.
              </p>
              <div className="mt-5 flex gap-3">
                <button
                  onClick={() => setConfirmandoEliminar(false)}
                  className="flex-1 rounded-lg border border-kb-border py-2 text-sm font-medium text-kb-text-secondary hover:text-kb-text transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={eliminar}
                  disabled={procesando}
                  className="flex-1 rounded-lg bg-kb-loss py-2 text-sm font-semibold text-white hover:brightness-110 transition disabled:opacity-60"
                >
                  {procesando ? "Eliminando…" : "Sí, eliminar"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// FORMULARIO PARA CERRAR una operación que quedó pendiente: elegís
// rápido si fue TP o SL, ponés el precio de salida y el P&L, y listo.
// =====================================================================

function FormularioCerrarTrade({
  trade,
  onCancelar,
  onCerrado,
}: {
  trade: Trade;
  onCancelar: () => void;
  onCerrado: () => void;
}) {
  const [resultType, setResultType] = useState<ResultType>("tp");
  const [exitPrice, setExitPrice] = useState("");
  const [pips, setPips] = useState("");
  const [fees, setFees] = useState(String(trade.fees ?? 0));
  const [pnlManual, setPnlManual] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const precioSalida = parseFloat(exitPrice);
    const pnlNumero = parseFloat(pnlManual);
    const comisiones = parseFloat(fees || "0");

    if (Number.isNaN(precioSalida) || Number.isNaN(pnlNumero)) {
      setError("Precio de salida y P&L son obligatorios y deben ser números.");
      return;
    }

    setEnviando(true);
    const { error: updateError } = await conReintento(() =>
      supabase
        .from("trades")
        .update({
          status: "closed",
          exit_price: precioSalida,
          pips: pips.trim() === "" ? null : parseFloat(pips),
          fees: comisiones,
          realized_pnl: Math.round((pnlNumero - comisiones) * 100) / 100,
          result_type: resultType,
          exit_time: new Date().toISOString(),
        })
        .eq("id", trade.id)
    );
    setEnviando(false);

    if (updateError) {
      setError(
        `No se pudo cerrar la operación (lo intentamos dos veces). Revisa tu conexión e intenta de nuevo. Detalle: ${updateError.message}`
      );
      return;
    }
    onCerrado();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-kb-text-secondary">
        Elegí cómo terminó tu operación de <span className="font-semibold text-kb-text">{trade.symbol}</span>.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setResultType("tp")}
          className={`rounded-lg border px-4 py-3 text-sm font-semibold transition-colors ${
            resultType === "tp"
              ? "border-kb-gain bg-kb-gain/10 text-kb-gain"
              : "border-kb-border text-kb-text-secondary hover:border-kb-gain/40"
          }`}
        >
          🎯 Take Profit
        </button>
        <button
          type="button"
          onClick={() => setResultType("sl")}
          className={`rounded-lg border px-4 py-3 text-sm font-semibold transition-colors ${
            resultType === "sl"
              ? "border-kb-loss bg-kb-loss/10 text-kb-loss"
              : "border-kb-border text-kb-text-secondary hover:border-kb-loss/40"
          }`}
        >
          🛑 Stop Loss
        </button>
      </div>

      <Campo etiqueta="¿Otro tipo de cierre?">
        <select value={resultType} onChange={(e) => setResultType(e.target.value as ResultType)} className={inputClass}>
          {Object.entries(RESULT_LABELS).map(([valor, etiqueta]) => (
            <option key={valor} value={valor}>{etiqueta}</option>
          ))}
        </select>
      </Campo>

      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Precio de salida">
          <input required type="number" step="any" value={exitPrice} onChange={(e) => setExitPrice(e.target.value)} className={inputClass} />
        </Campo>
        <Campo etiqueta="Pips (opcional)">
          <input type="number" step="any" value={pips} onChange={(e) => setPips(e.target.value)} className={inputClass} />
        </Campo>
        <Campo etiqueta="Comisión">
          <input type="number" step="any" value={fees} onChange={(e) => setFees(e.target.value)} className={inputClass} />
        </Campo>
        <Campo etiqueta="P&L (bruto)" ayuda="Restamos la comisión automáticamente">
          <input required type="number" step="any" value={pnlManual} onChange={(e) => setPnlManual(e.target.value)} placeholder="200 o -50" className={inputClass} />
        </Campo>
      </div>

      {error && (
        <p className="rounded-lg border border-kb-loss/30 bg-kb-loss/10 px-3 py-2 text-xs text-kb-loss">{error}</p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onCancelar}
          className="flex-1 rounded-lg border border-kb-border py-2.5 text-sm font-medium text-kb-text-secondary hover:text-kb-text transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={enviando}
          className="flex-1 rounded-lg bg-kb-accent py-2.5 text-sm font-semibold text-kb-bg hover:brightness-110 transition disabled:opacity-60"
        >
          {enviando ? "Guardando…" : "Cerrar operación"}
        </button>
      </div>
    </form>
  );
}

function DatoDetalle({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <p className="text-[11px] text-kb-text-secondary">{etiqueta}</p>
      <p className="font-medium text-kb-text">{valor}</p>
    </div>
  );
}

// =====================================================================
// FORMULARIO DE EDICIÓN de un trade existente (dentro del modal)
// =====================================================================

function FormularioEdicionTrade({
  trade,
  estrategias,
  onCancelar,
  onGuardado,
}: {
  trade: Trade;
  estrategias: Strategy[];
  onCancelar: () => void;
  onGuardado: () => void;
}) {
  const [symbol, setSymbol] = useState(trade.symbol);
  const [instrumentType, setInstrumentType] = useState<InstrumentType>(trade.instrument_type);
  const [side, setSide] = useState<TradeSide>(trade.side);
  const [quantity, setQuantity] = useState(String(trade.quantity));
  const [entryPrice, setEntryPrice] = useState(String(trade.entry_price));
  const [exitPrice, setExitPrice] = useState(trade.exit_price !== null ? String(trade.exit_price) : "");
  const [pips, setPips] = useState(trade.pips !== null ? String(trade.pips) : "");
  const [fees, setFees] = useState(String(trade.fees ?? 0));
  const [pnlManual, setPnlManual] = useState(
    trade.realized_pnl !== null ? String(trade.realized_pnl + (trade.fees ?? 0)) : ""
  );
  const [riskAmount, setRiskAmount] = useState(trade.risk_amount !== null ? String(trade.risk_amount) : "");
  const [resultType, setResultType] = useState<ResultType>(trade.result_type ?? "manual");
  const [session, setSession] = useState<TradingSession | "">(trade.session ?? "");
  const [strategyId, setStrategyId] = useState(trade.strategy_id ?? "");
  const [emotion, setEmotion] = useState<EmotionType | "">(trade.emotion ?? "");
  const [mistake, setMistake] = useState<MistakeType>(trade.mistake ?? "ninguno");
  const [tradingviewLinks, setTradingviewLinks] = useState<string[]>(
    trade.tradingview_links && trade.tradingview_links.length > 0 ? trade.tradingview_links : [""]
  );
  const [notes, setNotes] = useState(trade.notes ?? "");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const cantidad = parseFloat(quantity);
    const precioEntrada = parseFloat(entryPrice);
    const precioSalida = parseFloat(exitPrice);
    const pnlNumero = parseFloat(pnlManual);
    const comisiones = parseFloat(fees || "0");

    if (Number.isNaN(cantidad) || Number.isNaN(precioEntrada) || Number.isNaN(precioSalida) || Number.isNaN(pnlNumero)) {
      setError("Cantidad, precios y P&L son obligatorios y deben ser números.");
      return;
    }

    setEnviando(true);
    const { error: updateError } = await supabase
      .from("trades")
      .update({
        symbol: symbol.trim().toUpperCase(),
        instrument_type: instrumentType,
        side,
        quantity: cantidad,
        entry_price: precioEntrada,
        exit_price: precioSalida,
        pips: pips.trim() === "" ? null : parseFloat(pips),
        fees: comisiones,
        realized_pnl: Math.round((pnlNumero - comisiones) * 100) / 100,
        risk_amount: riskAmount.trim() === "" ? null : parseFloat(riskAmount),
        result_type: resultType,
        session: session === "" ? null : session,
        strategy_id: strategyId === "" ? null : strategyId,
        emotion: emotion === "" ? null : emotion,
        mistake,
        tradingview_links: tradingviewLinks.map((l) => l.trim()).filter((l) => l !== ""),
        notes: notes.trim() === "" ? null : notes.trim(),
      })
      .eq("id", trade.id);
    setEnviando(false);

    if (updateError) {
      setError("No se pudo guardar los cambios. Intenta de nuevo.");
      return;
    }
    onGuardado();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Símbolo">
          <input required value={symbol} onChange={(e) => setSymbol(e.target.value)} className={inputClass} />
        </Campo>
        <Campo etiqueta="Instrumento">
          <select value={instrumentType} onChange={(e) => setInstrumentType(e.target.value as InstrumentType)} className={inputClass}>
            {Object.entries(INSTRUMENT_LABELS).map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>{etiqueta}</option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Dirección">
          <select value={side} onChange={(e) => setSide(e.target.value as TradeSide)} className={inputClass}>
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </Campo>
        <Campo etiqueta="Cantidad">
          <input required type="number" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} />
        </Campo>
        <Campo etiqueta="Entrada">
          <input required type="number" step="any" value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} className={inputClass} />
        </Campo>
        <Campo etiqueta="Salida">
          <input required type="number" step="any" value={exitPrice} onChange={(e) => setExitPrice(e.target.value)} className={inputClass} />
        </Campo>
        <Campo etiqueta="Pips">
          <input type="number" step="any" value={pips} onChange={(e) => setPips(e.target.value)} className={inputClass} />
        </Campo>
        <Campo etiqueta="Comisión">
          <input type="number" step="any" value={fees} onChange={(e) => setFees(e.target.value)} className={inputClass} />
        </Campo>
        <Campo etiqueta="P&L (bruto)" ayuda="Se resta la comisión automáticamente al guardar">
          <input required type="number" step="any" value={pnlManual} onChange={(e) => setPnlManual(e.target.value)} className={inputClass} />
        </Campo>
        <Campo etiqueta="Monto arriesgado (R)" ayuda="Para calcular el R-múltiplo">
          <input type="number" step="any" value={riskAmount} onChange={(e) => setRiskAmount(e.target.value)} placeholder="Ej. 100" className={inputClass} />
        </Campo>
        <Campo etiqueta="Resultado">
          <select value={resultType} onChange={(e) => setResultType(e.target.value as ResultType)} className={inputClass}>
            {Object.entries(RESULT_LABELS).map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>{etiqueta}</option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Sesión">
          <select value={session} onChange={(e) => setSession(e.target.value as TradingSession | "")} className={inputClass}>
            <option value="">Sin especificar</option>
            {Object.entries(SESSION_LABELS).map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>{etiqueta}</option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Estrategia">
          <select value={strategyId} onChange={(e) => setStrategyId(e.target.value)} className={inputClass}>
            <option value="">Sin estrategia</option>
            {estrategias.map((est) => (
              <option key={est.id} value={est.id}>{est.name}</option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Emoción">
          <select value={emotion} onChange={(e) => setEmotion(e.target.value as EmotionType | "")} className={inputClass}>
            <option value="">Sin especificar</option>
            {Object.entries(EMOTION_LABELS).map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>{etiqueta}</option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Error">
          <select value={mistake} onChange={(e) => setMistake(e.target.value as MistakeType)} className={inputClass}>
            {Object.entries(MISTAKE_LABELS).map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>{etiqueta}</option>
            ))}
          </select>
        </Campo>
      </div>

      <div>
        <span className="mb-1 block text-xs font-medium text-kb-text-secondary">Links de TradingView</span>
        <div className="space-y-2">
          {tradingviewLinks.map((link, i) => (
            <div key={i} className="flex gap-2">
              <input
                type="url"
                value={link}
                onChange={(e) =>
                  setTradingviewLinks((prev) => prev.map((l, idx) => (idx === i ? e.target.value : l)))
                }
                className={inputClass}
              />
              {tradingviewLinks.length > 1 && (
                <button
                  type="button"
                  onClick={() => setTradingviewLinks((prev) => prev.filter((_, idx) => idx !== i))}
                  className="shrink-0 rounded-lg border border-kb-border px-3 text-sm text-kb-text-secondary hover:border-kb-loss hover:text-kb-loss transition-colors"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setTradingviewLinks((prev) => [...prev, ""])}
          className="mt-2 text-xs font-medium text-kb-accent hover:underline"
        >
          + Agregar otro link
        </button>
      </div>

      <Campo etiqueta="Notas">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={`${inputClass} resize-none`} />
      </Campo>

      {error && (
        <p className="rounded-lg border border-kb-loss/30 bg-kb-loss/10 px-3 py-2 text-xs text-kb-loss">{error}</p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onCancelar}
          className="flex-1 rounded-lg border border-kb-border py-2.5 text-sm font-medium text-kb-text-secondary hover:text-kb-text transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={enviando}
          className="flex-1 rounded-lg bg-kb-accent py-2.5 text-sm font-semibold text-kb-bg hover:brightness-110 transition disabled:opacity-60"
        >
          {enviando ? "Guardando…" : "Guardar cambios"}
        </button>
      </div>
    </form>
  );
}

function TablaTrades({
  trades,
  onSeleccionarTrade,
}: {
  trades: Trade[];
  onSeleccionarTrade: (trade: Trade) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-kb-border-soft text-xs text-kb-text-secondary">
            <th className="px-5 py-3 font-medium">Símbolo</th>
            <th className="px-5 py-3 font-medium">Instrumento</th>
            <th className="px-5 py-3 font-medium">Dirección</th>
            <th className="px-5 py-3 font-medium">Cantidad</th>
            <th className="px-5 py-3 font-medium">Entrada</th>
            <th className="px-5 py-3 font-medium">Salida</th>
            <th className="px-5 py-3 font-medium">Pips</th>
            <th className="px-5 py-3 font-medium">Resultado</th>
            <th className="px-5 py-3 font-medium">Sesión</th>
            <th className="px-5 py-3 font-medium">Emoción</th>
            <th className="px-5 py-3 font-medium">Error</th>
            <th className="px-5 py-3 font-medium">R</th>
            <th className="px-5 py-3 font-medium">P&L</th>
            <th className="px-5 py-3 font-medium">Fecha</th>
            <th className="px-5 py-3 font-medium">Evidencia</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => {
            const pnl = t.realized_pnl;
            const rMultiple = calcularRMultiple(pnl, t.risk_amount);

            return (
              <tr
                key={t.id}
                onClick={() => onSeleccionarTrade(t)}
                className="cursor-pointer border-b border-kb-border-soft hover:bg-kb-surface-raised transition-colors"
              >
                <td className="px-5 py-3 font-mono font-semibold">{t.symbol}</td>
                <td className="px-5 py-3 text-kb-text-secondary">
                  {INSTRUMENT_LABELS[t.instrument_type]}
                </td>
                <td className="px-5 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      t.side === "long"
                        ? "bg-kb-gain/10 text-kb-gain"
                        : "bg-kb-loss/10 text-kb-loss"
                    }`}
                  >
                    {t.side === "long" ? "Long" : "Short"}
                  </span>
                </td>
                <td className="px-5 py-3 font-mono">{t.quantity}</td>
                <td className="px-5 py-3 font-mono">{formatPrice(t.entry_price)}</td>
                <td className="px-5 py-3 font-mono">
                  {t.exit_price !== null ? formatPrice(t.exit_price) : "—"}
                </td>
                <td className="px-5 py-3 font-mono text-kb-text-secondary">
                  {t.pips !== null ? t.pips : "—"}
                </td>
                <td className="px-5 py-3">
                  {t.result_type ? (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        t.result_type === "tp"
                          ? "bg-kb-gain/10 text-kb-gain"
                          : t.result_type === "sl"
                          ? "bg-kb-loss/10 text-kb-loss"
                          : "bg-kb-border text-kb-text-secondary"
                      }`}
                    >
                      {RESULT_LABELS[t.result_type]}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-5 py-3 text-kb-text-secondary">
                  {t.session ? SESSION_LABELS[t.session] : "—"}
                </td>
                <td className="px-5 py-3 text-kb-text-secondary" title={t.emotion ? EMOTION_LABELS[t.emotion] : undefined}>
                  {t.emotion ? `${EMOTION_EMOJI[t.emotion]} ${EMOTION_LABELS[t.emotion]}` : "—"}
                </td>
                <td className="px-5 py-3">
                  {t.mistake && t.mistake !== "ninguno" ? (
                    <span className="rounded-full bg-kb-accent/10 px-2 py-0.5 text-xs font-medium text-kb-accent">
                      {MISTAKE_LABELS[t.mistake]}
                    </span>
                  ) : (
                    <span className="text-xs text-kb-text-muted">—</span>
                  )}
                </td>
                <td
                  className={`px-5 py-3 font-mono text-xs font-semibold ${
                    rMultiple === null ? "text-kb-text-muted" : rMultiple >= 0 ? "text-kb-gain" : "text-kb-loss"
                  }`}
                >
                  {formatRMultiple(rMultiple)}
                </td>
                <td
                  className={`px-5 py-3 font-mono font-semibold ${
                    t.status === "open"
                      ? "text-kb-accent"
                      : pnl === null
                      ? "text-kb-text-muted"
                      : pnl >= 0
                      ? "text-kb-gain"
                      : "text-kb-loss"
                  }`}
                >
                  {t.status === "open" ? (
                    <span className="rounded-full bg-kb-accent/10 px-2 py-0.5 text-xs font-medium">🕐 Pendiente</span>
                  ) : pnl === null ? (
                    "—"
                  ) : (
                    formatCurrency(pnl)
                  )}
                </td>
                <td className="px-5 py-3 text-kb-text-secondary">{formatDate(t.entry_time)}</td>
                <td className="px-5 py-3">
                  {t.tradingview_links && t.tradingview_links.length > 0 ? (
                    <a
                      href={t.tradingview_links[0]}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs text-kb-accent hover:underline"
                    >
                      Ver gráfico{t.tradingview_links.length > 1 ? ` (+${t.tradingview_links.length - 1})` : ""}
                    </a>
                  ) : (
                    <span className="text-xs text-kb-text-muted">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}