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
  type TradeExit,
  type PhaseHistoryEntry,
  type AccountChallengeType,
  CHALLENGE_TYPE_LABELS,
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

/**
 * BUGFIX: formatDate() interpreta el string con new Date(iso). Cuando el
 * valor es solo una fecha ("2026-07-05", sin hora), JS lo interpreta
 * como medianoche UTC, y al mostrarlo en un huso horario negativo (ej.
 * Brasil, GMT-3) el día se corre hacia atrás un día ("04 jul" en vez de
 * "05 jul"). Esta función arma la fecha con los componentes locales
 * directamente, evitando esa conversión UTC.
 */
function formatDateOnly(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString("es-ES", {
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

/**
 * BUGFIX: antes se usaba `trade.entry_time.slice(0, 10)` en varios
 * lugares para agrupar operaciones por día de calendario. El problema es
 * que entry_time se guarda como ISO en UTC (vía toISOString()), así que
 * cortar directamente el string te da el día en UTC, no el día local en
 * que el usuario realmente cargó la operación. Para alguien en un huso
 * horario negativo (ej. Brasil GMT-3), una operación cargada a las 22:00
 * podía terminar apareciendo en el calendario un día después del que
 * realmente eligió. Esta función siempre calcula la clave a partir de
 * los componentes de fecha LOCALES del Date, igual que hace el resto del
 * calendario (celdas, "hoy", etc.), para que todo quede consistente.
 */
function fechaKeyLocal(iso: string): string {
  const fecha = new Date(iso);
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-${String(
    fecha.getDate()
  ).padStart(2, "0")}`;
}

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

/** Calcula el R-múltiplo: cuántas veces el riesgo se ganó o perdió. */
function calcularRMultiple(pnl: number | null, riskAmount: number | null): number | null {
  if (pnl === null || riskAmount === null || riskAmount <= 0) return null;
  return pnl / riskAmount;
}

function formatRMultiple(r: number | null): string {
  if (r === null) return "—";
  return `${r >= 0 ? "+" : ""}${r.toFixed(2)}R`;
}

/**
 * Hace que cualquier modal se cierre al apretar la tecla Escape — antes
 * había que buscar la "✕" o un botón "Cancelar" sí o sí. Se usa junto
 * con onClick en el fondo oscuro (backdrop) para que también se cierre
 * al hacer clic afuera de la tarjeta del modal.
 */
function useCerrarConEscape(onClose: () => void) {
  useEffect(() => {
    function manejarTecla(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", manejarTecla);
    return () => window.removeEventListener("keydown", manejarTecla);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Cierra el modal al hacer clic en el fondo oscuro, pero no si el clic fue dentro de la tarjeta (evita que un clic dentro del modal lo cierre por error). */
function manejarClickFondo(e: React.MouseEvent<HTMLDivElement>, onClose: () => void) {
  if (e.target === e.currentTarget) onClose();
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

      {/* ---------- Hero con fondo de "hoja de diario" ---------- */}
      <section className="relative overflow-hidden border-b border-kb-border-soft">
        {/* Grilla de fondo, como el papel cuadriculado de un cuaderno de trading */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.15]"
          style={{
            backgroundImage:
              "linear-gradient(var(--kb-border) 1px, transparent 1px), linear-gradient(90deg, var(--kb-border) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
            maskImage: "radial-gradient(ellipse 80% 60% at 50% 20%, black 40%, transparent 90%)",
            WebkitMaskImage: "radial-gradient(ellipse 80% 60% at 50% 20%, black 40%, transparent 90%)",
          }}
        />
        {/* Curva de equity decorativa, como la que vas a ver de verdad adentro de la app */}
        <svg
          className="pointer-events-none absolute inset-x-0 bottom-0 h-40 w-full opacity-40"
          viewBox="0 0 1200 200"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="heroCurva" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--kb-gain)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--kb-gain)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0,170 C100,150 150,110 240,120 C330,130 380,60 470,70 C560,80 610,140 700,130 C790,120 840,40 930,50 C1020,60 1080,90 1200,20 L1200,200 L0,200 Z"
            fill="url(#heroCurva)"
          />
          <path
            d="M0,170 C100,150 150,110 240,120 C330,130 380,60 470,70 C560,80 610,140 700,130 C790,120 840,40 930,50 C1020,60 1080,90 1200,20"
            fill="none"
            stroke="var(--kb-gain)"
            strokeWidth="2"
          />
        </svg>

        <div className="relative mx-auto max-w-6xl px-6 py-20 text-center">
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
        </div>
      </section>

      {/* ---------- Cómo funciona ---------- */}
      <section className="mx-auto max-w-6xl px-6 py-16 border-b border-kb-border-soft">
        <div className="mb-10 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-kb-accent">Así de simple</p>
          <h2 className="mt-1 font-display text-2xl sm:text-3xl font-bold">Cómo funciona tu diario</h2>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <PasoComoFunciona numero="1" icono="📅" titulo="Registrás tu operación" texto="Un clic en el calendario y cargás símbolo, precios y cómo te sentiste al operar." />
          <PasoComoFunciona numero="2" icono="⚡" titulo="El P&L se calcula solo" texto="Nada de planillas de Excel — tu resultado neto aparece al instante, comisiones incluidas." />
          <PasoComoFunciona numero="3" icono="📊" titulo="Ves tus patrones reales" texto="Win rate, expectancy, en qué sesión rendís mejor y qué errores te cuestan más." />
          <PasoComoFunciona numero="4" icono="🎯" titulo="Repetís lo que funciona" texto="Con datos reales en vez de intuición, ajustás tu estrategia con cada operación que cargás." />
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

function PasoComoFunciona({
  numero,
  icono,
  titulo,
  texto,
}: {
  numero: string;
  icono: string;
  titulo: string;
  texto: string;
}) {
  return (
    <div className="relative rounded-xl border border-kb-border bg-kb-surface p-5">
      <span className="absolute right-4 top-4 font-mono text-3xl font-bold text-kb-border-soft">
        {numero}
      </span>
      <span className="text-2xl">{icono}</span>
      <h3 className="mt-3 font-display text-base font-semibold">{titulo}</h3>
      <p className="mt-1.5 text-sm text-kb-text-secondary">{texto}</p>
    </div>
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
  const [modo, setModo] = useState<"login" | "registro" | "recuperar">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  useCerrarConEscape(onClose);

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
      } else if (modo === "recuperar") {
        const { error: recoveryError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/restablecer-contrasena`,
        });
        if (recoveryError) throw recoveryError;
        setMensaje(
          "Si ese correo tiene una cuenta, te mandamos un link para restablecer tu contraseña. Revisá también la carpeta de spam."
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={(e) => manejarClickFondo(e, onClose)}
    >
      <div className="w-full max-w-sm rounded-2xl border border-kb-border bg-kb-surface p-7 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">
            {modo === "login" ? "Iniciar sesión" : modo === "registro" ? "Crear cuenta" : "Recuperar contraseña"}
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

          {modo !== "recuperar" && (
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
          )}

          {modo === "login" && (
            <button
              type="button"
              onClick={() => {
                setModo("recuperar");
                setError(null);
                setMensaje(null);
              }}
              className="block text-xs text-kb-text-secondary hover:text-kb-accent transition-colors"
            >
              ¿Olvidaste tu contraseña?
            </button>
          )}

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
              : modo === "registro"
              ? "Registrarme"
              : "Enviar link de recuperación"}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-kb-text-secondary">
          {modo === "recuperar" ? (
            <button
              onClick={() => {
                setModo("login");
                setError(null);
                setMensaje(null);
              }}
              className="font-semibold text-kb-accent hover:underline"
            >
              ← Volver a iniciar sesión
            </button>
          ) : (
            <>
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
            </>
          )}
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
  | "importar"
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
      { id: "roi", etiqueta: "Rentabilidad", icono: "💲" },
      { id: "retiros", etiqueta: "Retiros", icono: "🕓" },
      { id: "logros", etiqueta: "Logros", icono: "🏆" },
    ],
  },
  {
    titulo: "Datos",
    items: [{ id: "importar", etiqueta: "Importar", icono: "📥" }],
  },
  {
    titulo: "Cuenta",
    items: [{ id: "perfil", etiqueta: "Perfil", icono: "⚙️" }],
  },
];

const NAV_ITEMS: NavItem[] = NAV_GRUPOS.flatMap((g) => g.items);


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
    <div className="relative border-b border-kb-border-soft p-3">
      <div className="overflow-hidden rounded-xl border border-kb-border-soft bg-gradient-to-br from-kb-gain/10 via-kb-surface to-kb-surface p-3">
        <p className="text-[11px] font-medium text-kb-text-secondary">
          {cuentaActivaId === "todas" ? "Equity combinado" : "Equity de la cuenta"}
        </p>
        <p className={`mt-0.5 font-mono text-xl font-bold leading-tight ${equityMostrado >= 0 ? "text-kb-text" : "text-kb-loss"}`}>
          {formatCurrency(equityMostrado)}
        </p>

        <button
          onClick={() => setAbierto((v) => !v)}
          className="mt-2.5 flex w-full items-center justify-between rounded-lg border border-kb-border-soft bg-kb-bg/60 px-2.5 py-1.5 text-left transition-colors hover:border-kb-gain/40"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-kb-gain" />
            <span className="truncate text-xs font-medium text-kb-text">
              {cargando ? "Cargando…" : cuentaActivaId === "todas" ? "Todas las cuentas" : cuentaActiva?.name ?? "Sin cuenta"}
            </span>
          </span>
          <span className={`shrink-0 text-[10px] text-kb-text-muted transition-transform ${abierto ? "rotate-180" : ""}`}>
            ⌄
          </span>
        </button>
      </div>

      {abierto && (
        <div className="absolute left-3 right-3 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-kb-border bg-kb-surface-raised shadow-xl">
          <button
            onClick={() => {
              onSeleccionar("todas");
              setAbierto(false);
            }}
            className={`block w-full px-3 py-2.5 text-left text-xs font-medium transition-colors ${
              cuentaActivaId === "todas" ? "bg-kb-gain/10 text-kb-gain" : "text-kb-text hover:bg-kb-bg"
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
                  c.id === cuentaActivaId ? "bg-kb-gain/10 text-kb-gain" : "text-kb-text hover:bg-kb-bg"
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
            className="block w-full border-t border-kb-border-soft px-3 py-2.5 text-left text-xs font-medium text-kb-gain hover:bg-kb-bg transition-colors"
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

  // Sub-vista de "día del calendario": reemplaza las ventanas flotantes
  // que antes se abrían al hacer clic en un día. Ahora, en vez de un
  // modal, se muestra una vista de página completa dentro del mismo
  // panel de contenido (sin superponerse, con un botón "← Volver").
  const [vistaDia, setVistaDia] = useState<
    | { tipo: "elegir"; dia: string; trades: Trade[] }
    | { tipo: "detalle"; trade: Trade }
    | { tipo: "nuevo"; dia: string }
    | null
  >(null);

  function manejarAbrirDia(dia: string, tradesDelDia: Trade[]) {
    if (tradesDelDia.length === 0) {
      setVistaDia({ tipo: "nuevo", dia });
    } else if (tradesDelDia.length === 1) {
      setVistaDia({ tipo: "detalle", trade: tradesDelDia[0] });
    } else {
      setVistaDia({ tipo: "elegir", dia, trades: tradesDelDia });
    }
  }

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

  const [historialFases, setHistorialFases] = useState<PhaseHistoryEntry[]>([]);

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

  async function cargarHistorialFases() {
    const { data } = await supabase
      .from("phase_history")
      .select("*")
      .order("completado_en", { ascending: false });
    setHistorialFases((data as PhaseHistoryEntry[]) ?? []);
  }

  /**
   * Avanza una cuenta de una fase a otra (ej. Fase 1 → Fase 2, o Fase 1 /
   * Fase 2 → Financiada) sin crear una cuenta nueva: se guarda un
   * registro en el historial con el P&L que se logró en la fase que
   * termina, y la cuenta se actualiza para arrancar la fase nueva desde
   * cero (el progreso de la fase siguiente no arrastra ganancias de la
   * anterior).
   */
  async function avanzarFase(
    accountId: string,
    nuevaFase: AccountPhase,
    pnlAlcanzado: number,
    targetPercent: number | null
  ) {
    const cuenta = cuentas.find((c) => c.id === accountId);
    if (!cuenta) return;

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;

    await supabase.from("phase_history").insert({
      account_id: accountId,
      user_id: userId,
      phase: cuenta.phase,
      target_percent: targetPercent,
      pnl_alcanzado: pnlAlcanzado,
    });

    await supabase
      .from("accounts")
      .update({
        phase: nuevaFase,
        phase_started_at: new Date().toISOString(),
        phase_target_percent: null,
      })
      .eq("id", accountId);

    await Promise.all([cargarCuentas(), cargarHistorialFases()]);
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
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;

    if (yaCompletado) {
      await supabase
        .from("checklist_logs")
        .delete()
        .eq("item_id", itemId)
        .eq("log_date", todayKey())
        .eq("user_id", userId);
      setChecklistCompletados((prev) => {
        const nuevo = new Set(prev);
        nuevo.delete(itemId);
        return nuevo;
      });
    } else {
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
    cargarHistorialFases();
  }, []);

  /**
   * BUGFIX: al eliminar (o archivar) una cuenta desde Configuración, la
   * base de datos borra en cascada sus trades, retiros y desvincula sus
   * logros correctamente — pero el estado en memoria de React (trades,
   * retiros, logros) no se refrescaba solo, porque ConfiguracionView
   * únicamente llamaba a cargarCuentas(). Esto hacía que, aunque los
   * datos ya no existieran en Supabase, siguieran viéndose en pantalla
   * (dashboard, calendario, reportes, etc.) hasta recargar la página a
   * mano. Esta función recarga todo lo que puede haberse visto afectado
   * por un cambio en las cuentas.
   */
  async function recargarTrasCambioDeCuentas() {
    await Promise.all([cargarCuentas(), cargarTrades(), cargarRetiros(), cargarLogros()]);
  }

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

  /**
   * BUGFIX: filtro de seguridad. Si por algún motivo quedan trades o
   * retiros "huérfanos" en la base de datos (apuntando a una cuenta que
   * ya se eliminó — por ejemplo si el borrado en cascada fallara por un
   * problema de permisos/RLS y no se detectara), esto evita que sigan
   * apareciendo en la vista "Todas las cuentas". Solo se cuentan
   * operaciones y retiros de cuentas que siguen existiendo hoy.
   */
  const idsCuentasActivas = useMemo(() => new Set(cuentas.map((c) => c.id)), [cuentas]);

  const tradesDeLaCuenta = useMemo(() => {
    if (cuentaActivaId === "todas") {
      return trades.filter((t) => t.account_id !== null && idsCuentasActivas.has(t.account_id));
    }
    return trades.filter((t) => t.account_id === cuentaActivaId);
  }, [trades, cuentaActivaId, idsCuentasActivas]);

  const retirosDeLaCuenta = useMemo(() => {
    if (cuentaActivaId === "todas") {
      return retiros.filter((r) => idsCuentasActivas.has(r.account_id));
    }
    return retiros.filter((r) => r.account_id === cuentaActivaId);
  }, [retiros, cuentaActivaId, idsCuentasActivas]);

  const totalRetirado = useMemo(
    () => retirosDeLaCuenta.reduce((acc, r) => acc + r.amount, 0),
    [retirosDeLaCuenta]
  );

  // Total retirado por cuenta (para Rentabilidad y los chips)
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
    // NOTA: se removió el cálculo de "profit factor" (gananciaTotal /
    // perdidaTotal) a pedido — ya no se muestra en ningún panel de la UI.
    // "perdidaTotal" se conserva porque se usa abajo para "avgPerdida".

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
    // BUGFIX: si estabas viendo el detalle de un trade (o eligiendo cuál
    // ver, o cargando uno nuevo) desde el calendario, esa vista tenía
    // prioridad sobre el contenido normal — así que navegar desde el
    // sidebar no te sacaba de ahí. Ahora, cualquier clic en el menú
    // también cierra esa vista y te lleva a la sección elegida.
    setVistaDia(null);
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

          <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
            {navGruposFiltrados.map((grupo) => (
              <div key={grupo.titulo} className="rounded-xl border border-kb-border-soft bg-kb-bg/40 p-2">
                <p className="mb-1.5 flex items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-kb-text-muted">
                  <span className="h-1 w-1 rounded-full bg-kb-gain/70" />
                  {grupo.titulo}
                </p>
                <div className="space-y-0.5">
                  {grupo.items.map((item) => {
                    const activo = vista === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => irA(item.id)}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors ${
                          activo
                            ? "bg-kb-gain/10 text-kb-text"
                            : "text-kb-text-secondary hover:bg-kb-surface hover:text-kb-text"
                        }`}
                      >
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm transition-colors ${
                            activo ? "bg-kb-gain text-kb-bg" : "bg-kb-surface text-kb-text-secondary"
                          }`}
                        >
                          {item.icono}
                        </span>
                        <span className={activo ? "text-kb-gain" : ""}>{item.etiqueta}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="border-t border-kb-border-soft px-3 py-4">
            <div className="mb-3 flex items-center gap-2.5 px-1">
              <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-kb-gain/15 text-xs font-bold uppercase text-kb-gain">
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
            {vistaDia ? (
              <VistaDiaCalendario
                vistaDia={vistaDia}
                estrategias={estrategias}
                accountId={cuentaActivaId === "todas" ? null : cuentaActivaId}
                tieneCuentas={cuentas.length > 0}
                onVolver={() => setVistaDia(null)}
                onElegirTrade={(t) => setVistaDia({ tipo: "detalle", trade: t })}
                onAgregarOtra={(dia) => setVistaDia({ tipo: "nuevo", dia })}
                onTradeCreado={() => {
                  setVistaDia(null);
                  cargarTrades();
                }}
                onTradeActualizado={() => {
                  setVistaDia(null);
                  cargarTrades();
                }}
              />
            ) : (
              <>
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
                accountId={cuentaActivaId === "todas" ? null : cuentaActivaId}
                tieneCuentas={cuentas.length > 0}
                checklistItems={checklistItems}
                checklistCompletados={checklistCompletados}
                cargandoChecklist={cargandoChecklist}
                onToggleChecklist={alternarItemChecklist}
                onAgregarChecklistItem={agregarItemChecklist}
                onEliminarChecklistItem={eliminarItemChecklist}
                onAbrirDia={manejarAbrirDia}
                onAvanzarFase={avanzarFase}
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
                diaSeleccionado={diaParaRegistrar}
                onSeleccionarDia={setDiaParaRegistrar}
                onAbrirDia={manejarAbrirDia}
              />
            )}

            {vista === "reportes" && <ReportesView trades={tradesDeLaCuenta} estrategias={estrategias} />}

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

            {vista === "importar" && (
              <ImportarView
                cuentas={cuentas}
                estrategias={estrategias}
                onImportado={cargarTrades}
              />
            )}

            {vista === "perfil" && <PerfilView session={session} />}

            {vista === "configuracion" && (
              <ConfiguracionView
                cuentas={cuentas}
                trades={trades}
                pnlPorCuenta={pnlPorCuenta}
                retiradoPorCuenta={retiradoPorCuenta}
                historialFases={historialFases}
                onCambio={recargarTrasCambioDeCuentas}
                onVerArchivadas={() => setMostrarArchivadas(true)}
              />
            )}
              </>
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
  accountId,
  tieneCuentas,
  checklistItems,
  checklistCompletados,
  cargandoChecklist,
  onToggleChecklist,
  onAgregarChecklistItem,
  onEliminarChecklistItem,
  onAbrirDia,
  onAvanzarFase,
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
  accountId: string | null;
  tieneCuentas: boolean;
  checklistItems: ChecklistItem[];
  checklistCompletados: Set<string>;
  cargandoChecklist: boolean;
  onToggleChecklist: (itemId: string) => void;
  onAgregarChecklistItem: (texto: string) => void;
  onEliminarChecklistItem: (itemId: string) => void;
  onAbrirDia: (clave: string, tradesDelDia: Trade[]) => void;
  onAvanzarFase: (
    accountId: string,
    nuevaFase: AccountPhase,
    pnlAlcanzado: number,
    targetPercent: number | null
  ) => void;
}) {
  const balanceActual = cuenta ? cuenta.starting_balance + metricas.totalPnL - totalRetirado : 0;
  const progreso =
    cuenta && cuenta.starting_balance > 0 ? (metricas.totalPnL / cuenta.starting_balance) * 100 : 0;

  // ---- Progreso hacia el objetivo de la fase actual ----
  // Se cuenta el P&L SOLO desde que arrancó la fase actual (no desde
  // que se creó la cuenta), para que al avanzar de Fase 1 a Fase 2 el
  // contador empiece de cero y no arrastre ganancias de la fase anterior.
  const pnlDesdeInicioFase = useMemo(() => {
    if (!cuenta) return 0;
    const inicioFase = new Date(cuenta.phase_started_at).getTime();
    return trades
      .filter(
        (t) => t.status === "closed" && t.realized_pnl !== null && new Date(t.entry_time).getTime() >= inicioFase
      )
      .reduce((acc, t) => acc + (t.realized_pnl ?? 0), 0);
  }, [cuenta, trades]);

  const objetivoFaseMonto =
    cuenta && cuenta.phase_target_percent !== null
      ? (cuenta.starting_balance * cuenta.phase_target_percent) / 100
      : null;
  const progresoFasePorcentaje =
    objetivoFaseMonto && objetivoFaseMonto > 0
      ? Math.min((pnlDesdeInicioFase / objetivoFaseMonto) * 100, 100)
      : 0;
  const objetivoFaseAlcanzado = objetivoFaseMonto !== null && pnlDesdeInicioFase >= objetivoFaseMonto;

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

  // ---- Notificación del navegador cuando se cruza el umbral de riesgo ----
  // Solo se dispara si el usuario ya le dio permiso al navegador (ver el
  // botón "Activar alertas" más abajo), y como mucho una vez por cuenta
  // por día — para no spamear con la misma alerta en cada re-render.
  const [permisoNotificaciones, setPermisoNotificaciones] = useState<NotificationPermission | null>(null);
  const notificadoRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setPermisoNotificaciones(Notification.permission);
    }
  }, []);

  useEffect(() => {
    if (!alertaRiesgo || !cuenta) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    const clave = `${cuenta.id}-${todayKey()}`;
    if (notificadoRef.current === clave) return;
    notificadoRef.current = clave;

    const porcentajeMayor = Math.max(porcentajeDiario, porcentajeTotal);
    const tipoLimite = porcentajeDiario >= porcentajeTotal ? "diaria" : "total";
    new Notification("⚠️ Cerca del límite de pérdida", {
      body: `${cuenta.name}: llevás ${porcentajeMayor.toFixed(0)}% de tu límite de pérdida ${tipoLimite}. Cuidado con seguir operando.`,
      icon: "/logo-ktrader.png",
    });
  }, [alertaRiesgo, cuenta, porcentajeDiario, porcentajeTotal]);

  async function activarNotificaciones() {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const permiso = await Notification.requestPermission();
    setPermisoNotificaciones(permiso);
  }

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
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-kb-loss/40 bg-kb-loss/10 px-4 py-2.5">
              <span className="text-base">⚠️</span>
              <p className="text-sm font-medium text-kb-loss">
                Estás usando{" "}
                {porcentajeDiario >= porcentajeTotal
                  ? `${porcentajeDiario.toFixed(0)}% de tu límite de pérdida diaria`
                  : `${porcentajeTotal.toFixed(0)}% de tu límite de pérdida total`}
                . Cuidado con seguir operando hoy.
              </p>
              {permisoNotificaciones !== "granted" && permisoNotificaciones !== null && (
                <button
                  onClick={activarNotificaciones}
                  className="ml-auto shrink-0 rounded-lg border border-kb-loss/40 px-2.5 py-1 text-xs font-medium text-kb-loss hover:bg-kb-loss/10 transition-colors"
                >
                  🔔 Avisarme en el navegador
                </button>
              )}
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
                {cuenta.challenge_type && cuenta.challenge_type !== "capital_propio" && (
                  <span className="rounded-full border border-kb-border-soft px-2 py-0.5 text-[11px] font-medium text-kb-text-secondary">
                    {CHALLENGE_TYPE_LABELS[cuenta.challenge_type]}
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

            {objetivoFaseMonto !== null && (cuenta.phase === "fase_1" || cuenta.phase === "fase_2") && (
              <div className="mt-3 rounded-lg border border-kb-border-soft bg-kb-bg p-3">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="text-kb-text-secondary">
                    Objetivo de {PHASE_LABELS[cuenta.phase]}: {cuenta.phase_target_percent}%{" "}
                    ({formatCurrency(objetivoFaseMonto)})
                  </span>
                  <span className={objetivoFaseAlcanzado ? "font-semibold text-kb-gain" : "text-kb-text-secondary"}>
                    {progresoFasePorcentaje.toFixed(0)}%
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-kb-border">
                  <div
                    className={`h-full rounded-full transition-all ${objetivoFaseAlcanzado ? "bg-kb-gain" : "bg-kb-accent"}`}
                    style={{ width: `${progresoFasePorcentaje}%` }}
                  />
                </div>
                <p className="mt-1 text-right text-[11px] text-kb-text-muted">
                  Llevás {formatCurrency(pnlDesdeInicioFase)} desde que empezó esta fase
                </p>

                {objetivoFaseAlcanzado && (
                  <div className="mt-3 rounded-lg border border-kb-gain/30 bg-kb-gain/10 p-3">
                    <p className="text-sm font-semibold text-kb-gain">
                      🎉 ¡Alcanzaste el objetivo de {PHASE_LABELS[cuenta.phase]}!
                    </p>
                    <p className="mt-0.5 text-xs text-kb-text-secondary">
                      Esta misma cuenta avanza sola — no hace falta crear una nueva.
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {/* En Fase 1: si el challenge es de 2 fases (o es una cuenta
                          vieja sin tipo definido), se pasa a Fase 2. Si es de 1
                          fase, se salta directo a Financiada. */}
                      {cuenta.phase === "fase_1" &&
                        (cuenta.challenge_type === "una_fase" ? (
                          <button
                            onClick={() =>
                              onAvanzarFase(cuenta.id, "financiada", pnlDesdeInicioFase, cuenta.phase_target_percent)
                            }
                            className="rounded-lg bg-kb-gain px-3 py-1.5 text-xs font-semibold text-kb-bg hover:brightness-110 transition"
                          >
                            Marcar como Financiada
                          </button>
                        ) : (
                          <button
                            onClick={() =>
                              onAvanzarFase(cuenta.id, "fase_2", pnlDesdeInicioFase, cuenta.phase_target_percent)
                            }
                            className="rounded-lg bg-kb-accent px-3 py-1.5 text-xs font-semibold text-kb-bg hover:brightness-110 transition"
                          >
                            Pasar a Fase 2
                          </button>
                        ))}
                      {cuenta.phase === "fase_2" && (
                        <button
                          onClick={() =>
                            onAvanzarFase(cuenta.id, "financiada", pnlDesdeInicioFase, cuenta.phase_target_percent)
                          }
                          className="rounded-lg bg-kb-gain px-3 py-1.5 text-xs font-semibold text-kb-bg hover:brightness-110 transition"
                        >
                          Marcar como Financiada
                        </button>
                      )}
                    </div>
                  </div>
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

      {/* BUGFIX: antes esta condición incluía "!modoTodas", pero con 0
          cuentas el estado por defecto de cuentaActivaId es "todas" — o
          sea que modoTodas siempre es true en ese momento, y la condición
          contradictoria hacía que este bloque de bienvenida NUNCA se
          mostrara en la práctica, ni para usuarios nuevos. */}
      {cuentas.length === 0 && (() => {
        const pasoCuentaListo = cuentas.length > 0;
        const pasoTradeListo = trades.length > 0;
        const pasosListos = [pasoCuentaListo, pasoTradeListo].filter(Boolean).length;
        return (
          <section className="rounded-xl border border-dashed border-kb-accent/40 bg-kb-accent/5 p-6">
            <div className="mx-auto max-w-md text-center">
              <p className="text-2xl">👋</p>
              <h2 className="mt-2 font-display text-lg font-semibold text-kb-text">
                ¡Bienvenido a KeboTrader!
              </h2>
              <p className="mt-1 text-sm text-kb-text-secondary">
                {pasosListos === 0
                  ? "Te faltan unos pasos rápidos para tener tu diario andando."
                  : `Vas ${pasosListos} de 2 — ¡seguí así!`}
              </p>
              <div className="mx-auto mt-3 h-1.5 max-w-xs overflow-hidden rounded-full bg-kb-border">
                <div
                  className="h-full rounded-full bg-kb-gain transition-all"
                  style={{ width: `${(pasosListos / 2) * 100}%` }}
                />
              </div>
            </div>

            <div className="mx-auto mt-5 max-w-md space-y-3 text-left">
              <div className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${pasoCuentaListo ? "border-kb-gain/30 bg-kb-gain/5" : "border-kb-border-soft bg-kb-surface"}`}>
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${pasoCuentaListo ? "bg-kb-gain text-kb-bg" : "bg-kb-accent/15 text-kb-accent"}`}>
                  {pasoCuentaListo ? "✓" : "1"}
                </span>
                <div>
                  <p className={`text-sm font-medium ${pasoCuentaListo ? "text-kb-text-muted line-through" : "text-kb-text"}`}>
                    Creá tu primera cuenta
                  </p>
                  <p className="text-xs text-kb-text-secondary">
                    Usá el botón &quot;+ Nueva cuenta&quot; de arriba — puede ser demo o real.
                  </p>
                </div>
              </div>
              <div className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${pasoTradeListo ? "border-kb-gain/30 bg-kb-gain/5" : "border-kb-border-soft bg-kb-surface"}`}>
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${pasoTradeListo ? "bg-kb-gain text-kb-bg" : "bg-kb-accent/15 text-kb-accent"}`}>
                  {pasoTradeListo ? "✓" : "2"}
                </span>
                <div>
                  <p className={`text-sm font-medium ${pasoTradeListo ? "text-kb-text-muted line-through" : "text-kb-text"}`}>
                    Registrá tu primera operación
                  </p>
                  <p className="text-xs text-kb-text-secondary">
                    Andá al Calendario y hacé clic en un día para cargarla.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-lg border border-kb-border-soft bg-kb-surface px-3 py-2.5 opacity-70">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-kb-accent/15 text-xs font-bold text-kb-accent">
                  3
                </span>
                <div>
                  <p className="text-sm font-medium text-kb-text">Explorá tus Métricas</p>
                  <p className="text-xs text-kb-text-secondary">
                    Con un par de operaciones cargadas vas a empezar a ver patrones útiles. (Opcional, cuando quieras)
                  </p>
                </div>
              </div>
            </div>
          </section>
        );
      })()}

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
          diaSeleccionado={diaParaRegistrar}
          onSeleccionarDia={onSeleccionarDiaParaRegistrar}
          onVerCompleto={onIrACalendario}
          onAbrirDia={onAbrirDia}
          accountId={accountId}
          tieneCuentas={tieneCuentas}
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
                        {formatDateOnly(r.withdrawal_date)}
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

// =====================================================================
// VISTA DE PÁGINA COMPLETA para un día del calendario — reemplaza las
// ventanas flotantes que antes se abrían al hacer clic en un día. Tiene
// 3 variantes según lo que había ese día: elegir entre varias
// operaciones, ver el detalle completo de una sola, o registrar una
// nueva si el día estaba vacío.
// =====================================================================

type EstadoVistaDia =
  | { tipo: "elegir"; dia: string; trades: Trade[] }
  | { tipo: "detalle"; trade: Trade }
  | { tipo: "nuevo"; dia: string };

function VistaDiaCalendario({
  vistaDia,
  estrategias,
  accountId,
  tieneCuentas,
  onVolver,
  onElegirTrade,
  onAgregarOtra,
  onTradeCreado,
  onTradeActualizado,
}: {
  vistaDia: EstadoVistaDia;
  estrategias: Strategy[];
  accountId: string | null;
  tieneCuentas: boolean;
  onVolver: () => void;
  onElegirTrade: (trade: Trade) => void;
  onAgregarOtra: (dia: string) => void;
  onTradeCreado: () => void;
  onTradeActualizado: () => void;
}) {
  if (vistaDia.tipo === "detalle") {
    const diaDeEsteTrade = fechaKeyLocal(vistaDia.trade.entry_time);
    return (
      <div className="mx-auto max-w-lg space-y-3">
        <ModalDetalleTrade
          trade={vistaDia.trade}
          estrategias={estrategias}
          variante="pagina"
          onClose={onVolver}
          onActualizado={onTradeActualizado}
          onEliminado={onTradeActualizado}
        />
        <button
          onClick={() => onAgregarOtra(diaDeEsteTrade)}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-kb-accent/40 px-4 py-3 text-sm font-medium text-kb-accent hover:bg-kb-accent/10 transition-colors"
        >
          + Agregar otra operación este día
        </button>
      </div>
    );
  }

  if (vistaDia.tipo === "nuevo") {
    const fechaLegible = new Date(vistaDia.dia + "T00:00:00").toLocaleDateString("es-ES", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <button
          onClick={onVolver}
          className="rounded-lg border border-kb-border px-3 py-1.5 text-xs font-medium text-kb-text-secondary hover:border-kb-accent hover:text-kb-accent transition-colors"
        >
          ← Volver al calendario
        </button>
        <div>
          <h1 className="font-display text-xl font-bold text-kb-text">Registrar operación</h1>
          <p className="text-sm text-kb-text-secondary">{fechaLegible}</p>
        </div>
        <FormularioTrade
          accountId={accountId}
          tieneCuentas={tieneCuentas}
          diaParaRegistrar={vistaDia.dia}
          estrategiasDisponibles={estrategias}
          onTradeCreado={onTradeCreado}
        />
      </div>
    );
  }

  // vistaDia.tipo === "elegir"
  const fechaLegible = new Date(vistaDia.dia + "T00:00:00").toLocaleDateString("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <button
        onClick={onVolver}
        className="rounded-lg border border-kb-border px-3 py-1.5 text-xs font-medium text-kb-text-secondary hover:border-kb-accent hover:text-kb-accent transition-colors"
      >
        ← Volver al calendario
      </button>
      <div>
        <h1 className="font-display text-xl font-bold text-kb-text">Operaciones de este día</h1>
        <p className="text-sm text-kb-text-secondary">
          {fechaLegible} · {vistaDia.trades.length} operación{vistaDia.trades.length === 1 ? "" : "es"}{" "}
          registrada{vistaDia.trades.length === 1 ? "" : "s"} — elegí cuál querés ver
        </p>
      </div>

      <div className="space-y-2">
        {vistaDia.trades.map((t) => (
          <button
            key={t.id}
            onClick={() => onElegirTrade(t)}
            className="flex w-full items-center justify-between rounded-xl border border-kb-border bg-kb-surface px-4 py-3.5 text-left hover:border-kb-accent transition-colors"
          >
            <span className="flex items-center gap-3">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  t.side === "long" ? "bg-kb-gain/10 text-kb-gain" : "bg-kb-loss/10 text-kb-loss"
                }`}
              >
                {t.side === "long" ? "Long" : "Short"}
              </span>
              <span className="font-mono text-base font-semibold text-kb-text">{t.symbol}</span>
              {t.status === "open" && (
                <span className="rounded-full bg-kb-accent/10 px-2 py-0.5 text-xs font-medium text-kb-accent">
                  🕐 Pendiente
                </span>
              )}
            </span>
            <span
              className={`font-mono text-base font-semibold ${
                (t.realized_pnl ?? 0) >= 0 ? "text-kb-gain" : "text-kb-loss"
              }`}
            >
              {t.realized_pnl === null ? "—" : formatCurrency(t.realized_pnl)}
            </span>
          </button>
        ))}
      </div>

      <button
        onClick={() => onAgregarOtra(vistaDia.dia)}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-kb-accent/40 px-4 py-3.5 text-sm font-medium text-kb-accent hover:bg-kb-accent/10 transition-colors"
      >
        + Agregar otra operación
      </button>
    </div>
  );
}

function MiniCalendario({
  trades,
  diaSeleccionado,
  onSeleccionarDia,
  onVerCompleto,
  onAbrirDia,
  accountId,
  tieneCuentas,
}: {
  trades: Trade[];
  diaSeleccionado: string;
  onSeleccionarDia: (clave: string) => void;
  onVerCompleto: () => void;
  onAbrirDia: (clave: string, tradesDelDia: Trade[]) => void;
  accountId: string | null;
  tieneCuentas: boolean;
}) {
  const [mesActual, setMesActual] = useState(() => {
    const hoy = new Date();
    return { year: hoy.getFullYear(), month: hoy.getMonth() };
  });

  // BUGFIX: se usa fechaKeyLocal() en vez de entry_time.slice(0, 10). Ver
  // el comentario de esa función más arriba — evita que operaciones
  // cargadas de noche aparezcan en el día siguiente por la conversión a UTC.
  const resumenPorDia = useMemo(() => {
    const mapa = new Map<string, number>();
    trades
      .filter((t) => t.status === "closed" && t.realized_pnl !== null)
      .forEach((t) => {
        const clave = fechaKeyLocal(t.entry_time);
        mapa.set(clave, (mapa.get(clave) ?? 0) + (t.realized_pnl ?? 0));
      });
    return mapa;
  }, [trades]);

  const diasConPendiente = useMemo(() => {
    const set = new Set<string>();
    trades.filter((t) => t.status === "open").forEach((t) => set.add(fechaKeyLocal(t.entry_time)));
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
    const tradesDelDia = trades.filter((t) => fechaKeyLocal(t.entry_time) === clave);
    onSeleccionarDia(clave);
    onAbrirDia(clave, tradesDelDia);
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
  /** Si no se pasa, no se muestra el botón "Ver detalle" — se usa así
   * en la propia vista de Rentabilidad, donde no tendría sentido un
   * botón que te lleve a la página en la que ya estás parado. */
  onVerDetalle?: () => void;
}) {
  const maxBarra = Math.max(invertido, retirado, 1);

  return (
    <section className="rounded-xl border border-kb-border bg-kb-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold">Rentabilidad</h2>
        {onVerDetalle && (
          <button onClick={onVerDetalle} className="text-xs font-medium text-kb-accent hover:underline">
            Ver detalle →
          </button>
        )}
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

// =====================================================================
// VISTA: ESTRATEGIAS — tarjetas por estrategia con stats (operaciones,
// win rate, profit factor, neto) + su checklist de reglas — diseño
// propio de KeboTrader (barra de acento + barra de aciertos), sin
// copiar el layout de insignias/grilla de otras apps del rubro.
// =====================================================================

/** Paleta de acentos por estrategia, cíclica por índice: color de la barra superior y del punto de cada regla. */
const PALETA_ESTRATEGIA = [
  { barra: "bg-kb-accent", punto: "bg-kb-accent" },
  { barra: "bg-purple-500", punto: "bg-purple-400" },
  { barra: "bg-sky-500", punto: "bg-sky-400" },
  { barra: "bg-amber-500", punto: "bg-amber-400" },
  { barra: "bg-pink-500", punto: "bg-pink-400" },
  { barra: "bg-teal-500", punto: "bg-teal-400" },
];

interface StatsEstrategia {
  ops: number;
  winRate: number;
  profitFactor: number | null;
  neto: number;
}

/** Calcula OPS / win rate / profit factor / P&L neto de una estrategia (o de "sin estrategia" si strategyId es null). */
function calcularStatsEstrategia(trades: Trade[], strategyId: string | null): StatsEstrategia {
  const cerrados = trades.filter(
    (t) => t.status === "closed" && t.realized_pnl !== null && t.strategy_id === strategyId
  );
  const ops = cerrados.length;
  const ganadores = cerrados.filter((t) => (t.realized_pnl ?? 0) > 0);
  const perdedores = cerrados.filter((t) => (t.realized_pnl ?? 0) < 0);
  const winRate = ops > 0 ? (ganadores.length / ops) * 100 : 0;
  const gananciaTotal = ganadores.reduce((acc, t) => acc + (t.realized_pnl ?? 0), 0);
  const perdidaTotal = Math.abs(perdedores.reduce((acc, t) => acc + (t.realized_pnl ?? 0), 0));
  const profitFactor = perdidaTotal > 0 ? gananciaTotal / perdidaTotal : null;
  const neto = cerrados.reduce((acc, t) => acc + (t.realized_pnl ?? 0), 0);
  return { ops, winRate, profitFactor, neto };
}

function EstrategiasView({
  trades,
  estrategias,
  onCambio,
}: {
  trades: Trade[];
  estrategias: Strategy[];
  onCambio: () => void;
}) {
  const [mostrarModalNueva, setMostrarModalNueva] = useState(false);

  const statsSinEstrategia = useMemo(() => calcularStatsEstrategia(trades, null), [trades]);
  const totalOps = useMemo(
    () => estrategias.reduce((acc, e) => acc + calcularStatsEstrategia(trades, e.id).ops, 0),
    [trades, estrategias]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-kb-text">Tus estrategias</h1>
          <p className="mt-0.5 text-sm text-kb-text-secondary">
            {estrategias.length === 0
              ? "Todavía no armaste ningún setup."
              : `${estrategias.length} setup${estrategias.length === 1 ? "" : "s"} · ${totalOps} operación${totalOps === 1 ? "" : "es"} clasificada${totalOps === 1 ? "" : "s"}`}
          </p>
        </div>
        <button
          onClick={() => setMostrarModalNueva(true)}
          className="rounded-lg bg-kb-accent px-4 py-2.5 text-sm font-semibold text-kb-bg hover:brightness-110 transition"
        >
          + Nueva estrategia
        </button>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-kb-border-soft bg-kb-surface/60 px-4 py-3">
        <span className="mt-0.5 text-base">🧭</span>
        <p className="text-xs text-kb-text-secondary">
          Cada estrategia es un patrón que repetís una y otra vez — separarlas te deja ver{" "}
          <span className="font-medium text-kb-text">cuál setup realmente te da de comer</span> y
          cuál te conviene dejar de operar. Asigná una estrategia a cada trade desde el
          formulario de registro para que las tarjetas de abajo se llenen solas.
        </p>
      </div>

      {estrategias.length === 0 ? (
        <section className="rounded-xl border border-dashed border-kb-accent/40 bg-kb-accent/5 p-8 text-center">
          <p className="text-sm text-kb-text-secondary">
            Todavía no creaste ninguna estrategia. Definí tu primer setup con el botón de arriba.
          </p>
        </section>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {estrategias.map((est, i) => (
            <TarjetaEstrategia
              key={est.id}
              estrategia={est}
              stats={calcularStatsEstrategia(trades, est.id)}
              color={PALETA_ESTRATEGIA[i % PALETA_ESTRATEGIA.length]}
              onCambio={onCambio}
            />
          ))}
        </div>
      )}

      {statsSinEstrategia.ops > 0 && (
        <section className="rounded-xl border border-kb-border-soft bg-kb-surface/60 p-4">
          <p className="text-xs text-kb-text-secondary">
            <span className="font-semibold text-kb-text">{statsSinEstrategia.ops}</span> operación
            {statsSinEstrategia.ops === 1 ? "" : "es"} sin estrategia asignada · P&amp;L neto{" "}
            <span className={statsSinEstrategia.neto >= 0 ? "text-kb-gain" : "text-kb-loss"}>
              {formatCurrency(statsSinEstrategia.neto)}
            </span>
          </p>
        </section>
      )}

      {mostrarModalNueva && (
        <ModalNuevaEstrategia
          onClose={() => setMostrarModalNueva(false)}
          onCreada={() => {
            setMostrarModalNueva(false);
            onCambio();
          }}
        />
      )}
    </div>
  );
}

function ModalNuevaEstrategia({
  onClose,
  onCreada,
}: {
  onClose: () => void;
  onCreada: () => void;
}) {
  const [nombre, setNombre] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useCerrarConEscape(onClose);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const nombreLimpio = nombre.trim();
    if (!nombreLimpio) return;

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setError("Tu sesión expiró. Vuelve a iniciar sesión.");
      return;
    }

    setGuardando(true);
    const { error: insertError } = await supabase
      .from("strategies")
      .insert({ user_id: userId, name: nombreLimpio });
    setGuardando(false);

    if (insertError) {
      setError("No se pudo crear la estrategia. Intenta de nuevo.");
      return;
    }
    onCreada();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={(e) => manejarClickFondo(e, onClose)}
    >
      <div className="w-full max-w-sm rounded-2xl border border-kb-border bg-kb-surface p-7 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">Nueva estrategia</h2>
          <button onClick={onClose} className="text-kb-text-muted hover:text-kb-text transition" aria-label="Cerrar">
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Campo etiqueta="Nombre" ayuda="Ej. Breakout Apertura, Reversión Media…">
            <input
              autoFocus
              required
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej. Breakout Apertura"
              className={inputClass}
            />
          </Campo>
          {error && (
            <p className="rounded-lg border border-kb-loss/30 bg-kb-loss/10 px-3 py-2 text-xs text-kb-loss">{error}</p>
          )}
          <button
            type="submit"
            disabled={guardando}
            className="w-full rounded-lg bg-kb-accent py-2.5 text-sm font-semibold text-kb-bg hover:brightness-110 transition disabled:opacity-60"
          >
            {guardando ? "Creando…" : "Crear estrategia"}
          </button>
        </form>
      </div>
    </div>
  );
}

function TarjetaEstrategia({
  estrategia,
  stats,
  color,
  onCambio,
}: {
  estrategia: Strategy;
  stats: StatsEstrategia;
  color: { barra: string; punto: string };
  onCambio: () => void;
}) {
  const reglas = estrategia.rules ?? [];
  const [editandoNombre, setEditandoNombre] = useState(false);
  const [nombreEditado, setNombreEditado] = useState(estrategia.name);
  const [nuevaRegla, setNuevaRegla] = useState("");
  const [mostrarFormRegla, setMostrarFormRegla] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false);
  useCerrarConEscape(() => setConfirmandoEliminar(false));

  async function guardarNombre() {
    const nombreLimpio = nombreEditado.trim();
    if (!nombreLimpio || nombreLimpio === estrategia.name) {
      setEditandoNombre(false);
      setNombreEditado(estrategia.name);
      return;
    }
    await supabase.from("strategies").update({ name: nombreLimpio }).eq("id", estrategia.id);
    setEditandoNombre(false);
    onCambio();
  }

  async function agregarRegla(e: FormEvent) {
    e.preventDefault();
    const texto = nuevaRegla.trim();
    if (!texto) return;
    setGuardando(true);
    await supabase
      .from("strategies")
      .update({ rules: [...reglas, texto] })
      .eq("id", estrategia.id);
    setGuardando(false);
    setNuevaRegla("");
    setMostrarFormRegla(false);
    onCambio();
  }

  async function eliminarRegla(indice: number) {
    const nuevasReglas = reglas.filter((_, i) => i !== indice);
    await supabase.from("strategies").update({ rules: nuevasReglas }).eq("id", estrategia.id);
    onCambio();
  }

  async function eliminarEstrategia() {
    // No borramos los trades: solo desvinculamos la estrategia de ellos
    // (quedan como "Sin estrategia"), y después borramos la estrategia.
    await supabase.from("trades").update({ strategy_id: null }).eq("strategy_id", estrategia.id);
    await supabase.from("strategies").delete().eq("id", estrategia.id);
    onCambio();
  }

  return (
    <section className="overflow-hidden rounded-xl border border-kb-border bg-kb-surface">
      <div className={`h-1 w-full ${color.barra}`} />

      <div className="flex items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          {editandoNombre ? (
            <input
              autoFocus
              value={nombreEditado}
              onChange={(e) => setNombreEditado(e.target.value)}
              onBlur={guardarNombre}
              onKeyDown={(e) => {
                if (e.key === "Enter") guardarNombre();
                if (e.key === "Escape") {
                  setEditandoNombre(false);
                  setNombreEditado(estrategia.name);
                }
              }}
              className="rounded-md border border-kb-accent bg-kb-bg px-2 py-1 text-base font-semibold text-kb-text outline-none"
            />
          ) : (
            <h3 className="font-display text-base font-semibold text-kb-text">{estrategia.name}</h3>
          )}
          <p className="mt-0.5 text-xs text-kb-text-muted">
            {reglas.length} regla{reglas.length === 1 ? "" : "s"} de checklist
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => setEditandoNombre(true)}
            className="rounded-lg border border-kb-border p-1.5 text-kb-text-secondary hover:border-kb-accent hover:text-kb-accent transition-colors"
            aria-label="Renombrar estrategia"
            title="Renombrar"
          >
            ✎
          </button>
          <button
            onClick={() => setConfirmandoEliminar(true)}
            className="rounded-lg border border-kb-border p-1.5 text-kb-text-secondary hover:border-kb-loss hover:text-kb-loss transition-colors"
            aria-label="Eliminar estrategia"
            title="Eliminar"
          >
            🗑
          </button>
        </div>
      </div>

      <div className="px-5 pb-4 pt-3">
        {stats.ops === 0 ? (
          <p className="text-xs text-kb-text-muted">Todavía sin operaciones cerradas asignadas.</p>
        ) : (
          <>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-kb-text-secondary">P&amp;L de este setup</p>
                <p
                  className={`font-mono text-xl font-bold leading-tight ${
                    stats.neto >= 0 ? "text-kb-gain" : "text-kb-loss"
                  }`}
                >
                  {stats.neto >= 0 ? "+" : ""}
                  {formatCurrency(stats.neto)}
                </p>
              </div>
              <div className="text-right text-[11px] text-kb-text-secondary">
                <p>
                  {stats.ops} op{stats.ops === 1 ? "" : "s"} ·{" "}
                  <span className={stats.winRate >= 50 ? "text-kb-gain" : "text-kb-loss"}>
                    {stats.winRate.toFixed(0)}% acierto
                  </span>
                </p>
                <p>PF {stats.profitFactor !== null ? stats.profitFactor.toFixed(2) : "—"}</p>
              </div>
            </div>
            <div className="mt-2.5 flex h-1.5 w-full overflow-hidden rounded-full bg-kb-border">
              <div className="h-full bg-kb-gain" style={{ width: `${stats.winRate}%` }} />
              <div className="h-full bg-kb-loss" style={{ width: `${100 - stats.winRate}%` }} />
            </div>
          </>
        )}
      </div>

      <div className="border-t border-kb-border-soft p-4">
        {reglas.length === 0 ? (
          <p className="mb-3 text-xs text-kb-text-secondary">
            Todavía no tiene reglas. Agregá la primera abajo.
          </p>
        ) : (
          <ul className="mb-3 space-y-1.5">
            {reglas.map((regla, i) => (
              <li
                key={i}
                className="group flex items-center justify-between rounded-lg border border-kb-border-soft bg-kb-bg px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${color.punto}`} />
                  <span className="text-kb-text">{regla}</span>
                </span>
                <button
                  onClick={() => eliminarRegla(i)}
                  className="text-xs text-kb-text-muted opacity-0 hover:text-kb-loss group-hover:opacity-100 transition-opacity"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        {mostrarFormRegla ? (
          <form onSubmit={agregarRegla} className="flex gap-2">
            <input
              autoFocus
              value={nuevaRegla}
              onChange={(e) => setNuevaRegla(e.target.value)}
              placeholder="Ej. ¿Hay confirmación de volumen?"
              className={inputClass}
            />
            <button
              type="submit"
              disabled={guardando}
              className="shrink-0 rounded-lg bg-kb-accent px-3 text-sm font-medium text-kb-bg hover:brightness-110 transition disabled:opacity-60"
            >
              Agregar
            </button>
            <button
              type="button"
              onClick={() => {
                setMostrarFormRegla(false);
                setNuevaRegla("");
              }}
              className="shrink-0 rounded-lg border border-kb-border px-3 text-sm text-kb-text-secondary hover:text-kb-text transition-colors"
            >
              ✕
            </button>
          </form>
        ) : (
          <button
            onClick={() => setMostrarFormRegla(true)}
            className="text-xs font-medium text-kb-accent hover:underline"
          >
            + Añadir regla
          </button>
        )}
      </div>

      {confirmandoEliminar && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={(e) => manejarClickFondo(e, () => setConfirmandoEliminar(false))}
        >
          <div className="w-full max-w-sm rounded-2xl border border-kb-border bg-kb-surface p-6 shadow-2xl">
            <h3 className="font-display text-lg font-bold text-kb-text">
              ¿Eliminar &quot;{estrategia.name}&quot;?
            </h3>
            <p className="mt-2 text-sm text-kb-text-secondary">
              Sus reglas se pierden. Las {stats.ops} operación{stats.ops === 1 ? "" : "es"} que ya
              tenía asignada no se borran — quedan como &quot;Sin estrategia&quot;.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setConfirmandoEliminar(false)}
                className="flex-1 rounded-lg border border-kb-border py-2 text-sm font-medium text-kb-text-secondary hover:text-kb-text transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={eliminarEstrategia}
                className="flex-1 rounded-lg bg-kb-loss py-2 text-sm font-semibold text-white hover:brightness-110 transition"
              >
                Sí, eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// =====================================================================
// VISTA: REPORTES — insights automáticos a partir de los datos que ya
// se registran (sesión, día, emoción, error, rachas y drawdown)
// =====================================================================

/** Formatea minutos en un texto legible corto: "45min", "1h 27min", "2d 3h". */
function formatDuracionMin(minutos: number): string {
  if (minutos < 60) return `${Math.round(minutos)}min`;
  const horas = Math.floor(minutos / 60);
  const minRestantes = Math.round(minutos % 60);
  if (horas < 24) return minRestantes > 0 ? `${horas}h ${minRestantes}min` : `${horas}h`;
  const dias = Math.floor(horas / 24);
  const horasRestantes = horas % 24;
  return horasRestantes > 0 ? `${dias}d ${horasRestantes}h` : `${dias}d`;
}

/** Lista de rachas (ganadoras y perdedoras) del historial, para poder sacar tanto la máxima como el promedio. */
function calcularListaDeRachas(cerrados: Trade[]): { ganadoras: number[]; perdedoras: number[] } {
  const ganadoras: number[] = [];
  const perdedoras: number[] = [];
  let actual = 0;
  let tipoActual: "g" | "p" | null = null;

  cerrados.forEach((t) => {
    const tipo = (t.realized_pnl ?? 0) >= 0 ? "g" : "p";
    if (tipo === tipoActual) {
      actual++;
    } else {
      if (tipoActual === "g") ganadoras.push(actual);
      if (tipoActual === "p") perdedoras.push(actual);
      tipoActual = tipo;
      actual = 1;
    }
  });
  if (tipoActual === "g") ganadoras.push(actual);
  if (tipoActual === "p") perdedoras.push(actual);

  return { ganadoras, perdedoras };
}

function promedio(valores: number[]): number {
  return valores.length > 0 ? valores.reduce((a, v) => a + v, 0) / valores.length : 0;
}

const RANGOS_TIEMPO = [
  { id: "7d", etiqueta: "7D", dias: 7 },
  { id: "1m", etiqueta: "1M", dias: 30 },
  { id: "3m", etiqueta: "3M", dias: 90 },
  { id: "todo", etiqueta: "Todo", dias: null as number | null },
] as const;
type RangoTiempoId = (typeof RANGOS_TIEMPO)[number]["id"];

function ReportesView({ trades, estrategias }: { trades: Trade[]; estrategias: Strategy[] }) {
  const [rango, setRango] = useState<RangoTiempoId>("todo");

  const todosCerrados = useMemo(
    () =>
      trades
        .filter((t) => t.status === "closed" && t.realized_pnl !== null)
        .sort((a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime()),
    [trades]
  );

  // El rango de tiempo (7D/1M/3M/Todo) solo recorta las secciones de
  // desempeño reciente — el panel de "Rendimiento mensual" más abajo
  // siempre usa el historial completo, porque su gracia es mostrar
  // patrones a lo largo del tiempo.
  const cerrados = useMemo(() => {
    const config = RANGOS_TIEMPO.find((r) => r.id === rango);
    if (!config || config.dias === null) return todosCerrados;
    const limite = Date.now() - config.dias * 24 * 60 * 60 * 1000;
    return todosCerrados.filter((t) => new Date(t.entry_time).getTime() >= limite);
  }, [todosCerrados, rango]);

  const ganadores = useMemo(() => cerrados.filter((t) => (t.realized_pnl ?? 0) > 0), [cerrados]);
  const perdedores = useMemo(() => cerrados.filter((t) => (t.realized_pnl ?? 0) < 0), [cerrados]);

  const resultadoNeto = useMemo(() => cerrados.reduce((a, t) => a + (t.realized_pnl ?? 0), 0), [cerrados]);
  const winRate = cerrados.length > 0 ? (ganadores.length / cerrados.length) * 100 : 0;

  const gananciaTotal = useMemo(() => ganadores.reduce((a, t) => a + (t.realized_pnl ?? 0), 0), [ganadores]);
  const perdidaTotalAbs = useMemo(
    () => Math.abs(perdedores.reduce((a, t) => a + (t.realized_pnl ?? 0), 0)),
    [perdedores]
  );
  const profitFactor = perdidaTotalAbs > 0 ? gananciaTotal / perdidaTotalAbs : null;

  const expectancy = useMemo(() => {
    if (cerrados.length === 0) return null;
    const wr = ganadores.length / cerrados.length;
    const lr = perdedores.length / cerrados.length;
    const avgWin = ganadores.length > 0 ? gananciaTotal / ganadores.length : 0;
    const avgLoss = perdedores.length > 0 ? perdidaTotalAbs / perdedores.length : 0;
    return wr * avgWin - lr * avgLoss;
  }, [cerrados, ganadores, perdedores, gananciaTotal, perdidaTotalAbs]);

  const drawdown = useMemo(() => {
    let acumulado = 0;
    let pico = 0;
    let peorCaidaMonto = 0;
    let peorCaidaPorcentaje = 0;
    cerrados.forEach((t) => {
      acumulado += t.realized_pnl ?? 0;
      pico = Math.max(pico, acumulado);
      const caida = pico - acumulado;
      peorCaidaMonto = Math.max(peorCaidaMonto, caida);
      if (pico > 0) peorCaidaPorcentaje = Math.max(peorCaidaPorcentaje, (caida / pico) * 100);
    });
    return { monto: peorCaidaMonto, porcentaje: peorCaidaPorcentaje };
  }, [cerrados]);

  // ---- Duración promedio de ganadoras vs perdedoras ----
  const duracionProm = useMemo(() => {
    const minutosDe = (t: Trade) =>
      t.exit_time ? (new Date(t.exit_time).getTime() - new Date(t.entry_time).getTime()) / 60000 : null;
    const durGanadoras = ganadores.map(minutosDe).filter((m): m is number => m !== null && m >= 0);
    const durPerdedoras = perdedores.map(minutosDe).filter((m): m is number => m !== null && m >= 0);
    return { ganadoras: promedio(durGanadoras), perdedoras: promedio(durPerdedoras) };
  }, [ganadores, perdedores]);

  // ---- Rachas: máxima y promedio, separadas por tipo ----
  const rachas = useMemo(() => calcularListaDeRachas(cerrados), [cerrados]);
  const rachaMaxGanadora = rachas.ganadoras.length > 0 ? Math.max(...rachas.ganadoras) : 0;
  const rachaMaxPerdedora = rachas.perdedoras.length > 0 ? Math.max(...rachas.perdedoras) : 0;
  const rachaPromGanadora = promedio(rachas.ganadoras);
  const rachaPromPerdedora = promedio(rachas.perdedoras);

  // ---- Curva de equity del período filtrado ----
  const puntosEquity = useMemo(() => {
    let acumulado = 0;
    return cerrados.map((t) => {
      acumulado += t.realized_pnl ?? 0;
      return { fecha: t.entry_time, acumulado };
    });
  }, [cerrados]);

  // ---- "¿Dónde está tu edge?": por estrategia y por activo ----
  const porEstrategia = useMemo(() => {
    const grupos = new Map<string, { pnl: number; total: number; ganadores: number }>();
    cerrados.forEach((t) => {
      const clave = t.strategy_id ?? "sin_estrategia";
      const actual = grupos.get(clave) ?? { pnl: 0, total: 0, ganadores: 0 };
      actual.pnl += t.realized_pnl ?? 0;
      actual.total += 1;
      if ((t.realized_pnl ?? 0) > 0) actual.ganadores += 1;
      grupos.set(clave, actual);
    });
    return Array.from(grupos.entries())
      .map(([clave, d]) => ({
        etiqueta: clave === "sin_estrategia" ? "Sin estrategia" : estrategias.find((e) => e.id === clave)?.name ?? "—",
        ...d,
        winRate: (d.ganadores / d.total) * 100,
      }))
      .sort((a, b) => b.pnl - a.pnl);
  }, [cerrados, estrategias]);

  const porActivo = useMemo(() => {
    const grupos = new Map<string, { pnl: number; total: number; ganadores: number }>();
    cerrados.forEach((t) => {
      const actual = grupos.get(t.symbol) ?? { pnl: 0, total: 0, ganadores: 0 };
      actual.pnl += t.realized_pnl ?? 0;
      actual.total += 1;
      if ((t.realized_pnl ?? 0) > 0) actual.ganadores += 1;
      grupos.set(t.symbol, actual);
    });
    return Array.from(grupos.entries())
      .map(([simbolo, d]) => ({ etiqueta: simbolo, ...d, winRate: (d.ganadores / d.total) * 100 }))
      .sort((a, b) => b.pnl - a.pnl);
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

  // ---- Errores más frecuentes ----
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

  // ---- Rendimiento mensual por año (siempre con el historial completo) ----
  const rendimientoMensual = useMemo(() => {
    const mapa = new Map<number, number[]>(); // año -> [pnl x 12 meses]
    todosCerrados.forEach((t) => {
      const fecha = new Date(t.entry_time);
      const año = fecha.getFullYear();
      const mes = fecha.getMonth();
      if (!mapa.has(año)) mapa.set(año, Array(12).fill(0));
      mapa.get(año)![mes] += t.realized_pnl ?? 0;
    });
    return Array.from(mapa.entries()).sort((a, b) => b[0] - a[0]);
  }, [todosCerrados]);

  // ---- Frecuencia de operaciones ----
  const frecuenciaPorDiaSemana = useMemo(() => {
    const conteo = Array(7).fill(0);
    todosCerrados.forEach((t) => conteo[new Date(t.entry_time).getDay()]++);
    // Reordenamos para que arranque en lunes, como el resto del calendario.
    return [1, 2, 3, 4, 5, 6, 0].map((i) => ({ etiqueta: DIAS_SEMANA[[1, 2, 3, 4, 5, 6, 0].indexOf(i)], valor: conteo[i] }));
  }, [todosCerrados]);

  const frecuenciaPorMes = useMemo(() => {
    const conteo = Array(12).fill(0);
    todosCerrados.forEach((t) => conteo[new Date(t.entry_time).getMonth()]++);
    return MESES.map((m, i) => ({ etiqueta: m.slice(0, 3), valor: conteo[i] }));
  }, [todosCerrados]);

  if (todosCerrados.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-kb-border bg-kb-surface p-8 text-center">
        <p className="text-sm text-kb-text-secondary">
          Cierra algunas operaciones para desbloquear tus métricas automáticas aquí.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-kb-text">Métricas</h1>
          <p className="mt-0.5 text-sm text-kb-text-secondary">
            {cerrados.length} operación{cerrados.length === 1 ? "" : "es"} en el período seleccionado
          </p>
        </div>
        <div className="flex rounded-lg border border-kb-border-soft bg-kb-bg p-0.5">
          {RANGOS_TIEMPO.map((r) => (
            <button
              key={r.id}
              onClick={() => setRango(r.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                rango === r.id ? "bg-kb-gain text-kb-bg" : "text-kb-text-secondary hover:text-kb-text"
              }`}
            >
              {r.etiqueta}
            </button>
          ))}
        </div>
      </div>

      {/* ---------- Secciones que dependen del rango de tiempo elegido ---------- */}
      {cerrados.length === 0 ? (
        <section className="rounded-xl border border-dashed border-kb-border-soft bg-kb-surface/60 p-8 text-center">
          <p className="text-sm text-kb-text-secondary">
            No registraste operaciones en el período <span className="font-semibold text-kb-text">{RANGOS_TIEMPO.find((r) => r.id === rango)?.etiqueta}</span>.
          </p>
          <button
            onClick={() => setRango("todo")}
            className="mt-3 text-xs font-medium text-kb-gain hover:underline"
          >
            Ver todo el historial en cambio →
          </button>
        </section>
      ) : (
        <>
      {/* ---------- Fila de KPIs principales ---------- */}
      <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard
          etiqueta="Resultado neto"
          valor={formatCurrency(resultadoNeto)}
          tono={resultadoNeto >= 0 ? "gain" : "loss"}
        />
        <MetricCard etiqueta="Win rate" valor={`${winRate.toFixed(1)}%`} tono={winRate >= 50 ? "gain" : "loss"} />
        <MetricCard
          etiqueta="Profit factor"
          valor={profitFactor !== null ? profitFactor.toFixed(2) : "—"}
          tono={profitFactor !== null ? (profitFactor >= 1 ? "gain" : "loss") : undefined}
        />
        <MetricCard
          etiqueta="Expectativa / trade"
          valor={expectancy !== null ? formatCurrency(expectancy) : "—"}
          tono={expectancy !== null ? (expectancy >= 0 ? "gain" : "loss") : undefined}
        />
        <MetricCard
          etiqueta="Drawdown máximo"
          valor={formatCurrency(drawdown.monto)}
          tono={drawdown.monto > 0 ? "loss" : undefined}
        />
      </section>

      {/* ---------- Curva de equity del período ---------- */}
      <section className="rounded-xl border border-kb-border bg-kb-surface p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-base font-semibold">Curva de equity</h2>
          <span className="text-xs text-kb-text-muted">
            Caída máxima {formatCurrency(drawdown.monto)} ({drawdown.porcentaje.toFixed(1)}%)
          </span>
        </div>
        <MiniCurvaEquity puntos={puntosEquity} />
      </section>

      {/* ---------- Ganadores vs perdedores ---------- */}
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-kb-gain/30 bg-kb-gain/5 p-5">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-kb-gain">
            <span className="h-1.5 w-1.5 rounded-full bg-kb-gain" /> Ganadoras
          </p>
          <dl className="space-y-2.5 text-sm">
            <div className="flex justify-between"><dt className="text-kb-text-secondary">Total</dt><dd className="font-mono font-semibold text-kb-text">{ganadores.length}</dd></div>
            <div className="flex justify-between"><dt className="text-kb-text-secondary">Mayor ganancia</dt><dd className="font-mono font-semibold text-kb-gain">{ganadores.length > 0 ? formatCurrency(Math.max(...ganadores.map((t) => t.realized_pnl ?? 0))) : "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-kb-text-secondary">Promedio</dt><dd className="font-mono font-semibold text-kb-gain">{ganadores.length > 0 ? formatCurrency(gananciaTotal / ganadores.length) : "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-kb-text-secondary">Racha máx. / promedio</dt><dd className="font-mono font-semibold text-kb-text">{rachaMaxGanadora} / {rachaPromGanadora.toFixed(1)}</dd></div>
            <div className="flex justify-between"><dt className="text-kb-text-secondary">Duración promedio</dt><dd className="font-mono font-semibold text-kb-text">{ganadores.length > 0 ? formatDuracionMin(duracionProm.ganadoras) : "—"}</dd></div>
          </dl>
        </div>
        <div className="rounded-xl border border-kb-loss/30 bg-kb-loss/5 p-5">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-kb-loss">
            <span className="h-1.5 w-1.5 rounded-full bg-kb-loss" /> Perdedoras
          </p>
          <dl className="space-y-2.5 text-sm">
            <div className="flex justify-between"><dt className="text-kb-text-secondary">Total</dt><dd className="font-mono font-semibold text-kb-text">{perdedores.length}</dd></div>
            <div className="flex justify-between"><dt className="text-kb-text-secondary">Mayor pérdida</dt><dd className="font-mono font-semibold text-kb-loss">{perdedores.length > 0 ? formatCurrency(Math.min(...perdedores.map((t) => t.realized_pnl ?? 0))) : "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-kb-text-secondary">Promedio</dt><dd className="font-mono font-semibold text-kb-loss">{perdedores.length > 0 ? formatCurrency(-perdidaTotalAbs / perdedores.length) : "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-kb-text-secondary">Racha máx. / promedio</dt><dd className="font-mono font-semibold text-kb-text">{rachaMaxPerdedora} / {rachaPromPerdedora.toFixed(1)}</dd></div>
            <div className="flex justify-between"><dt className="text-kb-text-secondary">Duración promedio</dt><dd className="font-mono font-semibold text-kb-text">{perdedores.length > 0 ? formatDuracionMin(duracionProm.perdedoras) : "—"}</dd></div>
          </dl>
        </div>
      </section>

      {/* ---------- Dónde rendís mejor: estrategia + activo ---------- */}
      <section className="grid gap-4 lg:grid-cols-2">
        <TablaMetricaEdge titulo="Por estrategia" filas={porEstrategia} />
        <TablaMetricaEdge titulo="Por activo" filas={porActivo} />
      </section>

      {/* ---------- Rendimiento por sesión / día / emoción ---------- */}
      <ReporteBarras titulo="Rendimiento por sesión" subtitulo="¿En qué sesión de mercado rindes mejor?" filas={porSesion} />
      <ReporteBarras titulo="Rendimiento por emoción" subtitulo="¿Con qué estado emocional operas mejor?" filas={porEmocion} vacio="Todavía no registraste la emoción en ninguna operación." />

      {/* ---------- Errores más frecuentes ---------- */}
      <section className="rounded-xl border border-kb-border bg-kb-surface">
        <div className="border-b border-kb-border-soft px-5 py-4">
          <h2 className="font-display text-lg font-semibold">Errores más frecuentes</h2>
          <p className="text-xs text-kb-text-secondary">Cuánto te costó cada patrón de error</p>
        </div>
        {porError.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-kb-text-secondary">Sin errores registrados todavía — ¡buena señal!</p>
        ) : (
          <div className="divide-y divide-kb-border-soft">
            {porError.map((f) => (
              <div key={f.etiqueta} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium">{f.etiqueta}</p>
                  <p className="text-xs text-kb-text-secondary">{f.total} operacion{f.total === 1 ? "" : "es"}</p>
                </div>
                <span className={`font-mono text-sm font-semibold ${f.pnl >= 0 ? "text-kb-gain" : "text-kb-loss"}`}>{formatCurrency(f.pnl)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
        </>
      )}

      {/* ---------- Rendimiento mensual ---------- */}
      <section className="rounded-xl border border-kb-border bg-kb-surface">
        <div className="border-b border-kb-border-soft px-5 py-4">
          <h2 className="font-display text-lg font-semibold">Rendimiento mes a mes</h2>
          <p className="text-xs text-kb-text-secondary">Todo tu historial, sin importar el filtro de arriba</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-kb-border-soft text-kb-text-secondary">
                <th className="sticky left-0 bg-kb-surface px-4 py-2.5 font-medium">Año</th>
                {MESES.map((m) => (
                  <th key={m} className="px-3 py-2.5 text-center font-medium">{m.slice(0, 3)}</th>
                ))}
                <th className="px-4 py-2.5 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {rendimientoMensual.map(([año, meses]) => {
                const totalAño = meses.reduce((a, v) => a + v, 0);
                return (
                  <tr key={año} className="border-b border-kb-border-soft last:border-0">
                    <td className="sticky left-0 bg-kb-surface px-4 py-2.5 font-semibold text-kb-text">{año}</td>
                    {meses.map((v, i) => (
                      <td key={i} className={`px-3 py-2.5 text-center font-mono ${v === 0 ? "text-kb-text-muted" : v > 0 ? "text-kb-gain" : "text-kb-loss"}`}>
                        {v === 0 ? "—" : formatCurrency(v)}
                      </td>
                    ))}
                    <td className={`px-4 py-2.5 text-right font-mono font-semibold ${totalAño >= 0 ? "text-kb-gain" : "text-kb-loss"}`}>
                      {formatCurrency(totalAño)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------- Frecuencia de operaciones ---------- */}
      <section className="grid gap-4 lg:grid-cols-2">
        <GraficoFrecuencia titulo="Operaciones por día de la semana" datos={frecuenciaPorDiaSemana} />
        <GraficoFrecuencia titulo="Operaciones por mes" datos={frecuenciaPorMes} />
      </section>
    </div>
  );
}

/** Curva de equity compacta y propia para la vista de Métricas (distinta del gráfico grande del Dashboard). */
function MiniCurvaEquity({ puntos }: { puntos: Array<{ fecha: string; acumulado: number }> }) {
  if (puntos.length === 0) {
    return <p className="py-10 text-center text-sm text-kb-text-secondary">Sin operaciones en este período.</p>;
  }
  const ancho = 800;
  const alto = 180;
  const valores = puntos.map((p) => p.acumulado);
  const max = Math.max(...valores, 0);
  const min = Math.min(...valores, 0);
  const rango = max - min || 1;
  const coordX = (i: number) => (i / Math.max(puntos.length - 1, 1)) * ancho;
  const coordY = (v: number) => alto - ((v - min) / rango) * alto;
  const path = puntos.map((p, i) => `${i === 0 ? "M" : "L"} ${coordX(i)} ${coordY(p.acumulado)}`).join(" ");
  const final = puntos[puntos.length - 1].acumulado;
  const color = final >= 0 ? "var(--kb-gain)" : "var(--kb-loss)";

  return (
    <svg viewBox={`0 0 ${ancho} ${alto}`} className="h-40 w-full" preserveAspectRatio="none">
      <path d={path} fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

/** Tabla compacta "Nombre / Ops / Winrate (barra) / Neto", para comparar estrategias o activos entre sí. */
function TablaMetricaEdge({ titulo, filas }: { titulo: string; filas: FilaReporte[] }) {
  return (
    <section className="rounded-xl border border-kb-border bg-kb-surface">
      <div className="border-b border-kb-border-soft px-5 py-4">
        <h2 className="font-display text-base font-semibold">{titulo}</h2>
      </div>
      {filas.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-kb-text-secondary">Sin datos todavía.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-kb-border-soft text-kb-text-secondary">
                <th className="px-4 py-2.5 font-medium">Nombre</th>
                <th className="px-3 py-2.5 font-medium">Ops</th>
                <th className="px-3 py-2.5 font-medium">Winrate</th>
                <th className="px-4 py-2.5 text-right font-medium">Neto</th>
              </tr>
            </thead>
            <tbody>
              {filas.slice(0, 8).map((f) => (
                <tr key={f.etiqueta} className="border-b border-kb-border-soft last:border-0">
                  <td className="px-4 py-2.5 font-medium text-kb-text">{f.etiqueta}</td>
                  <td className="px-3 py-2.5 font-mono text-kb-text-secondary">{f.total}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-kb-border">
                        <div className="h-full bg-kb-gain" style={{ width: `${f.winRate}%` }} />
                      </div>
                      <span className="font-mono text-kb-text-secondary">{f.winRate.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className={`px-4 py-2.5 text-right font-mono font-semibold ${f.pnl >= 0 ? "text-kb-gain" : "text-kb-loss"}`}>
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

/** Barras verticales simples para mostrar cuántas operaciones hacés según el día/mes — no es P&L, es frecuencia. */
function GraficoFrecuencia({ titulo, datos }: { titulo: string; datos: { etiqueta: string; valor: number }[] }) {
  const max = Math.max(...datos.map((d) => d.valor), 1);
  const total = datos.reduce((a, d) => a + d.valor, 0);
  const bucketsActivos = datos.filter((d) => d.valor > 0).length || 1;
  const promedioTexto = (total / bucketsActivos).toFixed(1);

  return (
    <section className="rounded-xl border border-kb-border bg-kb-surface p-5">
      <h2 className="font-display text-base font-semibold">{titulo}</h2>
      <p className="mb-4 text-xs text-kb-text-secondary">Promedio {promedioTexto} operaciones por período activo</p>
      <div className="flex h-32 items-end gap-2">
        {datos.map((d) => (
          <div key={d.etiqueta} className="flex flex-1 flex-col items-center gap-1">
            <div
              className="w-full rounded-t-sm bg-kb-gain/70"
              style={{ height: `${Math.max((d.valor / max) * 100, d.valor > 0 ? 6 : 0)}%` }}
              title={`${d.valor} operaciones`}
            />
            <span className="text-[10px] text-kb-text-muted">{d.etiqueta}</span>
          </div>
        ))}
      </div>
    </section>
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
        <p className="text-sm text-kb-text-secondary">Crea una cuenta para ver su rentabilidad aquí.</p>
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
      />

      <section className="rounded-xl border border-kb-border bg-kb-surface">
        <div className="border-b border-kb-border-soft px-5 py-4">
          <h2 className="font-display text-lg font-semibold">Rentabilidad por cuenta</h2>
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

  const totalRetirado = useMemo(() => retiros.reduce((acc, r) => acc + r.amount, 0), [retiros]);

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
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-bold text-kb-text">Retiros</h1>
        <p className="mt-0.5 text-sm text-kb-text-secondary">
          {retiros.length === 0
            ? "Todavía no registraste ningún retiro."
            : `${retiros.length} retiro${retiros.length === 1 ? "" : "s"} registrado${retiros.length === 1 ? "" : "s"} · ${formatCurrency(totalRetirado)} en total`}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <section className="h-fit rounded-xl border border-kb-border bg-kb-surface p-5">
          <h2 className="font-display text-base font-semibold mb-1">Sacar ganancias</h2>
          <p className="mb-4 text-xs text-kb-text-secondary">
            Cada retiro que cargues acá ajusta tu balance y tu rentabilidad automáticamente.
          </p>

          {cuentas.length === 0 ? (
            <p className="rounded-lg border border-kb-accent/30 bg-kb-accent/10 px-3 py-2 text-xs text-kb-accent">
              Crea una cuenta primero para poder registrar retiros.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
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
                <p className="rounded-lg border border-kb-loss/30 bg-kb-loss/10 px-3 py-2 text-xs text-kb-loss">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={enviando}
                className="w-full rounded-lg bg-kb-gain py-2.5 text-sm font-semibold text-kb-bg hover:brightness-110 transition disabled:opacity-60"
              >
                {enviando ? "Guardando…" : "Registrar retiro"}
              </button>
            </form>
          )}
        </section>

        <section className="overflow-hidden rounded-xl border border-kb-border bg-kb-surface">
          <div className="flex items-center justify-between border-b border-kb-border-soft px-5 py-4">
            <h2 className="font-display text-base font-semibold">Historial</h2>
            {retiros.length > 0 && (
              <span className="rounded-full bg-kb-gain/10 px-3 py-1 text-xs font-semibold text-kb-gain">
                Total {formatCurrency(totalRetirado)}
              </span>
            )}
          </div>

          {cargando ? (
            <SkeletonFilas filas={4} />
          ) : retiros.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-kb-text-secondary">
              Todavía no registraste ningún retiro.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-kb-border-soft text-xs text-kb-text-secondary">
                    <th className="px-5 py-3 font-medium">Fecha</th>
                    <th className="px-5 py-3 font-medium">Cuenta</th>
                    <th className="px-5 py-3 font-medium">Notas</th>
                    <th className="px-5 py-3 font-medium text-right">Monto</th>
                    <th className="px-5 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {retiros.map((r) => {
                    const cuentaDelRetiro = cuentas.find((c) => c.id === r.account_id);
                    return (
                      <tr key={r.id} className="border-b border-kb-border-soft last:border-0">
                        <td className="px-5 py-3 text-kb-text-secondary">{formatDateOnly(r.withdrawal_date)}</td>
                        <td className="px-5 py-3 font-medium text-kb-text">
                          {cuentaDelRetiro?.name ?? "Cuenta eliminada"}
                        </td>
                        <td className="px-5 py-3 text-kb-text-muted">{r.notes ?? "—"}</td>
                        <td className="px-5 py-3 text-right font-mono font-semibold text-kb-gain">
                          +{formatCurrency(r.amount)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button
                            onClick={() => eliminar(r.id)}
                            className="text-xs text-kb-text-muted hover:text-kb-loss transition-colors"
                          >
                            Eliminar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
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
    // Borramos primero el archivo del bucket (si tenía uno adjunto), para
    // no dejar certificados huérfanos ocupando espacio de Storage.
    if (logro.file_url) {
      const ruta = extraerRutaStorage("achievements", logro.file_url);
      await supabase.storage.from("achievements").remove([ruta]);
    }
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
          {formatDateOnly(logro.achieved_date)}
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
    const fotoAnterior = avatarUrl;
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

    // Borramos la foto anterior del Storage — si no, cada vez que alguien
    // cambia de foto de perfil, la vieja queda ocupando espacio para
    // siempre sin que nada la use más.
    if (fotoAnterior) {
      const rutaAnterior = extraerRutaStorage("avatars", fotoAnterior);
      await supabase.storage.from("avatars").remove([rutaAnterior]);
    }
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
// VISTA: IMPORTAR — importador genérico de CSV. No asume el formato de
// ningún broker en particular: el usuario sube cualquier CSV y mapea a
// mano qué columna corresponde a qué campo (símbolo, precios, fechas,
// etc.), así funciona sea cual sea la plataforma de origen.
// =====================================================================

/** Parser de CSV básico (soporta comillas y campos con comas adentro). Detecta "," o ";" como separador. */
function parsearCSV(texto: string): string[][] {
  const primerSalto = texto.indexOf("\n");
  const primeraLinea = primerSalto === -1 ? texto : texto.slice(0, primerSalto);
  const separador = (primeraLinea.match(/;/g)?.length ?? 0) > (primeraLinea.match(/,/g)?.length ?? 0) ? ";" : ",";

  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let entreComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === separador) {
      fila.push(campo);
      campo = "";
    } else if (c === "\r") {
      // ignorar, lo maneja el \n siguiente
    } else if (c === "\n") {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else {
      campo += c;
    }
  }
  if (campo !== "" || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas.filter((f) => f.some((v) => v.trim() !== ""));
}

/** Convierte un texto numérico de CSV (con comas de miles, símbolos de moneda, etc.) a número. */
function parsearNumeroCSV(valor: string | undefined): number | null {
  if (!valor) return null;
  const limpio = valor.replace(/[^0-9.,\-]/g, "").trim();
  if (limpio === "") return null;
  // Si tiene coma Y punto, asumimos que la coma es separador de miles (formato "1,234.56")
  const normalizado = limpio.includes(",") && limpio.includes(".") ? limpio.replace(/,/g, "") : limpio.replace(",", ".");
  const n = parseFloat(normalizado);
  return Number.isNaN(n) ? null : n;
}

/** Convierte una fecha de CSV a ISO. Soporta el formato con puntos típico de MT4/MT5 ("2026.07.05 14:30:00"). */
function parsearFechaCSV(valor: string | undefined): string | null {
  if (!valor) return null;
  const conGuiones = valor.trim().replace(/^(\d{4})\.(\d{2})\.(\d{2})/, "$1-$2-$3");
  const fecha = new Date(conGuiones);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

type CampoDestino =
  | "symbol"
  | "side"
  | "quantity"
  | "entry_price"
  | "exit_price"
  | "entry_time"
  | "exit_time"
  | "realized_pnl"
  | "fees"
  | "notes";

const CAMPOS_IMPORTACION: { campo: CampoDestino; etiqueta: string; requerido: boolean }[] = [
  { campo: "symbol", etiqueta: "Símbolo", requerido: true },
  { campo: "side", etiqueta: "Dirección (compra/venta)", requerido: false },
  { campo: "quantity", etiqueta: "Cantidad / Lotes", requerido: true },
  { campo: "entry_price", etiqueta: "Precio de entrada", requerido: true },
  { campo: "exit_price", etiqueta: "Precio de salida", requerido: false },
  { campo: "entry_time", etiqueta: "Fecha/hora de entrada", requerido: true },
  { campo: "exit_time", etiqueta: "Fecha/hora de salida", requerido: false },
  { campo: "realized_pnl", etiqueta: "P&L / Ganancia", requerido: false },
  { campo: "fees", etiqueta: "Comisión", requerido: false },
  { campo: "notes", etiqueta: "Notas / Comentario", requerido: false },
];

function ImportarView({
  cuentas,
  estrategias,
  onImportado,
}: {
  cuentas: Account[];
  estrategias: Strategy[];
  onImportado: () => void;
}) {
  const [paso, setPaso] = useState<"subir" | "mapear" | "revisar" | "listo">("subir");
  const [nombreArchivo, setNombreArchivo] = useState("");
  const [encabezados, setEncabezados] = useState<string[]>([]);
  const [filasDatos, setFilasDatos] = useState<string[][]>([]);
  const [mapeo, setMapeo] = useState<Partial<Record<CampoDestino, number>>>({});
  const [accountId, setAccountId] = useState("");
  const [strategyId, setStrategyId] = useState("");
  const [sideDefault, setSideDefault] = useState<TradeSide>("long");
  const [error, setError] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<{ insertados: number; saltados: number } | null>(null);
  const [mostrarGuia, setMostrarGuia] = useState(true);

  function manejarArchivo(archivo: File) {
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const texto = String(e.target?.result ?? "");
      const filas = parsearCSV(texto);
      if (filas.length < 2) {
        setError("El archivo no parece tener datos (se necesita al menos un encabezado y una fila).");
        return;
      }
      setEncabezados(filas[0]);
      setFilasDatos(filas.slice(1));
      setNombreArchivo(archivo.name);

      // Auto-mapeo básico: si alguna columna se llama parecido a lo que
      // buscamos, la pre-seleccionamos (el usuario puede corregirla).
      const autoMapeo: Partial<Record<CampoDestino, number>> = {};
      const alias: Record<CampoDestino, string[]> = {
        symbol: ["symbol", "simbolo", "símbolo", "ticker", "instrument", "activo"],
        side: ["side", "type", "tipo", "direction", "direccion"],
        quantity: ["quantity", "cantidad", "lots", "lotes", "volume", "volumen", "size"],
        entry_price: ["entry", "open price", "precio entrada", "precio apertura", "openprice"],
        exit_price: ["exit", "close price", "precio salida", "precio cierre", "closeprice"],
        entry_time: ["entry time", "open time", "fecha entrada", "fecha apertura", "opentime"],
        exit_time: ["exit time", "close time", "fecha salida", "fecha cierre", "closetime"],
        realized_pnl: ["profit", "pnl", "p&l", "ganancia", "resultado", "ganancia neta"],
        fees: ["commission", "comision", "comisión", "fee", "fees", "swap"],
        notes: ["comment", "comentario", "notes", "notas"],
      };
      filas[0].forEach((encabezado, i) => {
        const normalizado = encabezado.trim().toLowerCase();
        (Object.keys(alias) as CampoDestino[]).forEach((campo) => {
          if (autoMapeo[campo] === undefined && alias[campo].some((a) => normalizado.includes(a))) {
            autoMapeo[campo] = i;
          }
        });
      });
      setMapeo(autoMapeo);
      setPaso("mapear");
    };
    reader.readAsText(archivo);
  }

  function validarMapeo(): string | null {
    const faltantes = CAMPOS_IMPORTACION.filter((c) => c.requerido && mapeo[c.campo] === undefined);
    if (faltantes.length > 0) {
      return `Faltan mapear campos obligatorios: ${faltantes.map((f) => f.etiqueta).join(", ")}.`;
    }
    if (!accountId) return "Elegí a qué cuenta se van a importar estas operaciones.";
    return null;
  }

  async function confirmarImportacion() {
    const errorValidacion = validarMapeo();
    if (errorValidacion) {
      setError(errorValidacion);
      return;
    }
    setError(null);
    setImportando(true);

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setImportando(false);
      setError("Tu sesión expiró. Vuelve a iniciar sesión.");
      return;
    }

    const filasParaInsertar: Record<string, unknown>[] = [];
    let saltados = 0;

    for (const fila of filasDatos) {
      const obtener = (campo: CampoDestino): string | undefined => {
        const idx = mapeo[campo];
        return idx !== undefined ? fila[idx] : undefined;
      };

      const symbol = obtener("symbol")?.trim();
      const quantity = parsearNumeroCSV(obtener("quantity"));
      const entryPrice = parsearNumeroCSV(obtener("entry_price"));
      const entryTime = parsearFechaCSV(obtener("entry_time"));

      if (!symbol || quantity === null || entryPrice === null || !entryTime) {
        saltados++;
        continue;
      }

      const exitPrice = parsearNumeroCSV(obtener("exit_price"));
      const exitTime = parsearFechaCSV(obtener("exit_time"));
      const realizedPnl = parsearNumeroCSV(obtener("realized_pnl"));
      const fees = parsearNumeroCSV(obtener("fees")) ?? 0;
      const notes = obtener("notes")?.trim() || null;

      const sideTexto = obtener("side")?.trim().toLowerCase();
      let side: TradeSide = sideDefault;
      if (sideTexto) {
        if (sideTexto.includes("sell") || sideTexto.includes("short") || sideTexto.includes("venta")) {
          side = "short";
        } else if (sideTexto.includes("buy") || sideTexto.includes("long") || sideTexto.includes("compra")) {
          side = "long";
        }
      }

      const estaCerrado = exitPrice !== null || realizedPnl !== null;

      filasParaInsertar.push({
        user_id: userId,
        account_id: accountId,
        strategy_id: strategyId === "" ? null : strategyId,
        symbol: symbol.toUpperCase(),
        instrument_type: "forex" as InstrumentType,
        side,
        status: estaCerrado ? "closed" : "open",
        quantity,
        entry_price: entryPrice,
        exit_price: exitPrice,
        fees,
        realized_pnl: estaCerrado ? (realizedPnl ?? 0) - fees : null,
        result_type: estaCerrado ? "manual" : null,
        notes,
        entry_time: entryTime,
        exit_time: exitTime,
        tradingview_links: [],
        evidence_images: [],
        mistake: "ninguno",
      });
    }

    // Insertamos en tandas de 200 para no mandar un solo request gigante.
    let insertados = 0;
    for (let i = 0; i < filasParaInsertar.length; i += 200) {
      const tanda = filasParaInsertar.slice(i, i + 200);
      const { error: insertError } = await supabase.from("trades").insert(tanda);
      if (!insertError) insertados += tanda.length;
      else saltados += tanda.length;
    }

    setImportando(false);
    setResultado({ insertados, saltados });
    setPaso("listo");
    onImportado();
  }

  function reiniciar() {
    setPaso("subir");
    setNombreArchivo("");
    setEncabezados([]);
    setFilasDatos([]);
    setMapeo({});
    setError(null);
    setResultado(null);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold text-kb-text">Importar operaciones</h1>
        <p className="mt-0.5 text-sm text-kb-text-secondary">
          Subí un CSV exportado de tu broker o plataforma. Funciona con cualquier formato —
          vos le decís qué columna es cada cosa.
        </p>
      </div>

      <section className="rounded-xl border border-kb-border bg-kb-surface">
        <button
          onClick={() => setMostrarGuia((v) => !v)}
          className="flex w-full items-center justify-between px-5 py-3.5 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-kb-text">
            📖 ¿Cómo saco el CSV de mi cuenta?
          </span>
          <span className={`text-kb-text-muted transition-transform ${mostrarGuia ? "rotate-180" : ""}`}>⌄</span>
        </button>

        {mostrarGuia && (
          <div className="space-y-4 border-t border-kb-border-soft px-5 py-4">
            <div>
              <p className="mb-1.5 text-sm font-semibold text-kb-accent">Desde MT5 (escritorio)</p>
              <ol className="list-decimal space-y-1 pl-5 text-xs text-kb-text-secondary">
                <li>Abrí MetaTrader 5 y andá a la pestaña <span className="text-kb-text">"Trade"</span> abajo de la pantalla.</li>
                <li>Hacé clic en la sub-pestaña <span className="text-kb-text">"History"</span> (Historial).</li>
                <li>
                  Click derecho sobre la tabla → <span className="text-kb-text">"Custom period"</span> para elegir el
                  rango de fechas (o "Todo el historial").
                </li>
                <li>
                  Click derecho de nuevo → <span className="text-kb-text">"Report" → "Save as Report"</span> (o
                  "Export to CSV" según tu versión).
                </li>
                <li>Guardalo en tu computadora — ese es el archivo que subís acá abajo.</li>
              </ol>
              <p className="mt-1.5 text-[11px] text-kb-text-muted">
                Si tu versión solo exporta a Excel/HTML: abrilo y hacé "Guardar como" → elegí formato CSV.
              </p>
            </div>

            <div>
              <p className="mb-1.5 text-sm font-semibold text-kb-accent">Cuenta de prop firm (FTMO, FundedNext, MyForexFunds, etc.)</p>
              <p className="text-xs text-kb-text-secondary">
                Entrá al dashboard web de tu prop firm (no MT5) y buscá la sección{" "}
                <span className="text-kb-text">"Trading History"</span> o{" "}
                <span className="text-kb-text">"Statement"</span> — casi todas tienen un botón de
                exportar/descargar CSV directo ahí, suele ser más simple que desde MT5.
              </p>
            </div>

            <div>
              <p className="mb-1.5 text-sm font-semibold text-kb-accent">Otro bróker (IBKR, cTrader, etc.)</p>
              <p className="text-xs text-kb-text-secondary">
                Buscá la sección de <span className="text-kb-text">"Historial de operaciones"</span>,{" "}
                <span className="text-kb-text">"Trade History"</span> o{" "}
                <span className="text-kb-text">"Statements"</span> en la web o plataforma de tu bróker.
                El nombre cambia según cada uno, pero todos tienen una opción de exportar a CSV o Excel
                cerca de donde ves tus operaciones cerradas.
              </p>
            </div>

            <p className="rounded-lg border border-kb-accent/30 bg-kb-accent/10 px-3 py-2 text-[11px] text-kb-accent">
              💡 No importa el formato exacto de columnas que traiga tu archivo — en el siguiente
              paso vas a poder decirle a mano a KeboTrader cuál columna es cuál.
            </p>
          </div>
        )}
      </section>

      {paso === "subir" && (
        <section className="rounded-xl border border-dashed border-kb-accent/40 bg-kb-accent/5 p-8 text-center">
          <p className="mb-4 text-sm text-kb-text-secondary">
            Elegí un archivo .csv exportado de MT4, MT5, cTrader, o cualquier otra plataforma.
          </p>
          <label className="inline-block cursor-pointer rounded-lg bg-kb-accent px-5 py-2.5 text-sm font-semibold text-kb-bg hover:brightness-110 transition">
            Elegir archivo CSV
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const archivo = e.target.files?.[0];
                if (archivo) manejarArchivo(archivo);
              }}
            />
          </label>
        </section>
      )}

      {paso === "mapear" && (
        <>
          <section className="rounded-xl border border-kb-border bg-kb-surface p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-display text-lg font-semibold">Mapear columnas</h2>
                <p className="text-xs text-kb-text-secondary">
                  {nombreArchivo} · {filasDatos.length} fila{filasDatos.length === 1 ? "" : "s"} detectada
                  {filasDatos.length === 1 ? "" : "s"}
                </p>
              </div>
              <button onClick={reiniciar} className="text-xs font-medium text-kb-text-secondary hover:text-kb-text">
                Elegir otro archivo
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {CAMPOS_IMPORTACION.map(({ campo, etiqueta, requerido }) => (
                <Campo key={campo} etiqueta={`${etiqueta}${requerido ? " *" : ""}`}>
                  <select
                    value={mapeo[campo] ?? ""}
                    onChange={(e) =>
                      setMapeo((prev) => ({
                        ...prev,
                        [campo]: e.target.value === "" ? undefined : Number(e.target.value),
                      }))
                    }
                    className={inputClass}
                  >
                    <option value="">— No mapear —</option>
                    {encabezados.map((enc, i) => (
                      <option key={i} value={i}>
                        {enc || `Columna ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </Campo>
              ))}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Campo etiqueta="Importar a la cuenta *">
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputClass}>
                  <option value="">Elegí una cuenta…</option>
                  {cuentas.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </Campo>
              <Campo etiqueta="Estrategia (opcional)">
                <select value={strategyId} onChange={(e) => setStrategyId(e.target.value)} className={inputClass}>
                  <option value="">Sin estrategia</option>
                  {estrategias.map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </Campo>
              <Campo
                etiqueta="Dirección por defecto"
                ayuda={mapeo.side !== undefined ? "Se usa solo si una fila no trae dirección clara" : "No mapeaste columna de dirección — se usa esta para todas"}
              >
                <select value={sideDefault} onChange={(e) => setSideDefault(e.target.value as TradeSide)} className={inputClass}>
                  <option value="long">Long (compra)</option>
                  <option value="short">Short (venta)</option>
                </select>
              </Campo>
            </div>

            {error && (
              <p className="mt-4 rounded-lg border border-kb-loss/30 bg-kb-loss/10 px-3 py-2 text-xs text-kb-loss">
                {error}
              </p>
            )}

            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setPaso("revisar")}
                className="rounded-lg bg-kb-accent px-5 py-2.5 text-sm font-semibold text-kb-bg hover:brightness-110 transition"
              >
                Ver vista previa →
              </button>
            </div>
          </section>
        </>
      )}

      {paso === "revisar" && (
        <section className="rounded-xl border border-kb-border bg-kb-surface p-5">
          <h2 className="font-display text-lg font-semibold mb-1">Vista previa</h2>
          <p className="mb-4 text-xs text-kb-text-secondary">
            Mostrando las primeras 5 de {filasDatos.length} filas, con el mapeo que elegiste.
            Revisá que los datos tengan sentido antes de confirmar.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-kb-border-soft text-kb-text-secondary">
                  {CAMPOS_IMPORTACION.filter((c) => mapeo[c.campo] !== undefined).map((c) => (
                    <th key={c.campo} className="px-3 py-2 font-medium">{c.etiqueta}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filasDatos.slice(0, 5).map((fila, i) => (
                  <tr key={i} className="border-b border-kb-border-soft">
                    {CAMPOS_IMPORTACION.filter((c) => mapeo[c.campo] !== undefined).map((c) => (
                      <td key={c.campo} className="px-3 py-2 text-kb-text">
                        {fila[mapeo[c.campo] as number] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error && (
            <p className="mt-4 rounded-lg border border-kb-loss/30 bg-kb-loss/10 px-3 py-2 text-xs text-kb-loss">
              {error}
            </p>
          )}

          <div className="mt-5 flex gap-3">
            <button
              onClick={() => setPaso("mapear")}
              className="rounded-lg border border-kb-border px-5 py-2.5 text-sm font-medium text-kb-text-secondary hover:text-kb-text transition-colors"
            >
              ← Volver a mapear
            </button>
            <button
              onClick={confirmarImportacion}
              disabled={importando}
              className="rounded-lg bg-kb-accent px-5 py-2.5 text-sm font-semibold text-kb-bg hover:brightness-110 transition disabled:opacity-60"
            >
              {importando ? "Importando…" : `Importar ${filasDatos.length} operaciones`}
            </button>
          </div>
        </section>
      )}

      {paso === "listo" && resultado && (
        <section className="rounded-xl border border-kb-gain/30 bg-kb-gain/5 p-8 text-center">
          <p className="text-3xl">✅</p>
          <h2 className="mt-2 font-display text-lg font-semibold text-kb-text">Importación completa</h2>
          <p className="mt-1 text-sm text-kb-text-secondary">
            <span className="font-semibold text-kb-gain">{resultado.insertados}</span> operaciones
            importadas correctamente
            {resultado.saltados > 0 && (
              <>
                {" "}
                · <span className="font-semibold text-kb-loss">{resultado.saltados}</span> filas
                se saltearon (les faltaban datos obligatorios o el formato no se pudo leer)
              </>
            )}
            .
          </p>
          <button
            onClick={reiniciar}
            className="mt-4 rounded-lg border border-kb-border px-5 py-2.5 text-sm font-medium text-kb-text-secondary hover:text-kb-text transition-colors"
          >
            Importar otro archivo
          </button>
        </section>
      )}
    </div>
  );
}

// =====================================================================
// VISTA: CONFIGURACIÓN — gestión de cuentas (crear vive en el header,
// aquí se edita/archiva/elimina, y se pueden ver las archivadas)
// =====================================================================

function ConfiguracionView({
  cuentas,
  trades,
  pnlPorCuenta,
  retiradoPorCuenta,
  historialFases,
  onCambio,
  onVerArchivadas,
}: {
  cuentas: Account[];
  trades: Trade[];
  pnlPorCuenta: Map<string, number>;
  retiradoPorCuenta: Map<string, number>;
  historialFases: PhaseHistoryEntry[];
  onCambio: () => void;
  onVerArchivadas: () => void;
}) {
  const [cuentaEditando, setCuentaEditando] = useState<Account | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-kb-text">Tus cuentas de fondeo</h1>
          <p className="mt-0.5 text-sm text-kb-text-secondary">
            {cuentas.length} cuenta{cuentas.length === 1 ? "" : "s"} activa{cuentas.length === 1 ? "" : "s"} · costo,
            retiros y rendimiento en un solo vistazo
          </p>
        </div>
        <button
          onClick={onVerArchivadas}
          className="text-xs font-medium text-kb-text-secondary hover:text-kb-gain transition-colors underline-offset-2 hover:underline"
        >
          Ver cuentas archivadas
        </button>
      </div>

      {cuentas.length === 0 ? (
        <section className="rounded-xl border border-dashed border-kb-accent/40 bg-kb-accent/5 p-8 text-center">
          <p className="text-sm text-kb-text-secondary">
            No tenés ninguna cuenta activa todavía. Creá una desde el selector del sidebar.
          </p>
        </section>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {cuentas.map((c, i) => (
            <TarjetaCuenta
              key={c.id}
              cuenta={c}
              trades={trades}
              pnl={pnlPorCuenta.get(c.id) ?? 0}
              retirado={retiradoPorCuenta.get(c.id) ?? 0}
              color={PALETA_ESTRATEGIA[i % PALETA_ESTRATEGIA.length]}
              historial={historialFases.filter((h) => h.account_id === c.id)}
              onEditar={() => setCuentaEditando(c)}
              onCambio={onCambio}
            />
          ))}
        </div>
      )}

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

function TarjetaCuenta({
  cuenta,
  trades,
  pnl,
  retirado,
  color,
  historial,
  onEditar,
  onCambio,
}: {
  cuenta: Account;
  trades: Trade[];
  pnl: number;
  retirado: number;
  color: { barra: string; punto: string };
  historial: PhaseHistoryEntry[];
  onEditar: () => void;
  onCambio: () => void;
}) {
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [conteo, setConteo] = useState<{ trades: number; retiros: number } | null>(null);
  const [cargandoConteo, setCargandoConteo] = useState(false);
  const [errorEliminar, setErrorEliminar] = useState<string | null>(null);
  useCerrarConEscape(() => {
    setConfirmandoEliminar(false);
    setErrorEliminar(null);
  });

  const cerrados = useMemo(
    () => trades.filter((t) => t.account_id === cuenta.id && t.status === "closed" && t.realized_pnl !== null),
    [trades, cuenta.id]
  );
  const ganadores = cerrados.filter((t) => (t.realized_pnl ?? 0) > 0).length;
  const winRate = cerrados.length > 0 ? (ganadores / cerrados.length) * 100 : null;
  const invertido = cuenta.purchase_cost ?? cuenta.starting_balance;

  // ---- Progreso hacia el objetivo de la fase actual (mismo cálculo que
  // en el Dashboard, para que también se vea acá sin tener que
  // seleccionar la cuenta o abrir "Editar"). ----
  const pnlDesdeInicioFase = useMemo(() => {
    const inicioFase = new Date(cuenta.phase_started_at).getTime();
    return cerrados
      .filter((t) => new Date(t.entry_time).getTime() >= inicioFase)
      .reduce((acc, t) => acc + (t.realized_pnl ?? 0), 0);
  }, [cerrados, cuenta.phase_started_at]);

  const objetivoFaseMonto =
    cuenta.phase_target_percent !== null ? (cuenta.starting_balance * cuenta.phase_target_percent) / 100 : null;
  const progresoFasePorcentaje =
    objetivoFaseMonto && objetivoFaseMonto > 0
      ? Math.min((pnlDesdeInicioFase / objetivoFaseMonto) * 100, 100)
      : 0;

  async function archivar() {
    setProcesando(true);
    await supabase.from("accounts").update({ is_archived: true }).eq("id", cuenta.id);
    setProcesando(false);
    onCambio();
  }

  async function abrirConfirmacion() {
    setConfirmandoEliminar(true);
    setCargandoConteo(true);
    const [tradesRes, retirosRes] = await Promise.all([
      supabase.from("trades").select("id", { count: "exact", head: true }).eq("account_id", cuenta.id),
      supabase.from("withdrawals").select("id", { count: "exact", head: true }).eq("account_id", cuenta.id),
    ]);
    setConteo({ trades: tradesRes.count ?? 0, retiros: retirosRes.count ?? 0 });
    setCargandoConteo(false);
  }

  async function eliminar() {
    setProcesando(true);
    setErrorEliminar(null);

    // Borrado en cascada explícito: primero las operaciones y retiros de
    // esta cuenta, después desvinculamos los logros (no se borran, son
    // certificados/documentos), y al final la cuenta misma.
    //
    // BUGFIX: antes no se revisaba si estos pasos fallaban (por ejemplo,
    // por un permiso de Supabase/RLS mal configurado en "trades" o
    // "withdrawals"). Si fallaban, el código igual seguía adelante y
    // borraba la cuenta, dejando esas operaciones "huérfanas" en la base
    // — apuntando a una cuenta que ya no existía, y que por eso seguían
    // apareciendo en el Dashboard. Ahora, si cualquiera de estos pasos
    // falla, se detiene todo el proceso y se avisa en vez de continuar.
    // Antes de borrar los trades en bloque, traemos sus imágenes de
    // evidencia para borrarlas del Storage también — si no, quedan
    // ocupando espacio para siempre, apuntando a trades que ya no existen.
    const { data: tradesConImagenes } = await supabase
      .from("trades")
      .select("evidence_images")
      .eq("account_id", cuenta.id);
    const todasLasRutas = ((tradesConImagenes as { evidence_images: string[] }[]) ?? [])
      .flatMap((t) => t.evidence_images ?? [])
      .map((r) => extraerRutaStorage("trade-evidence", r));
    if (todasLasRutas.length > 0) {
      await supabase.storage.from("trade-evidence").remove(todasLasRutas);
    }

    const borradoTrades = await supabase.from("trades").delete().eq("account_id", cuenta.id);
    if (borradoTrades.error) {
      setProcesando(false);
      setErrorEliminar(
        `No se pudieron borrar las operaciones de esta cuenta (${borradoTrades.error.message}). La cuenta NO se eliminó para evitar dejar datos huérfanos.`
      );
      return;
    }

    const borradoRetiros = await supabase.from("withdrawals").delete().eq("account_id", cuenta.id);
    if (borradoRetiros.error) {
      setProcesando(false);
      setErrorEliminar(
        `No se pudieron borrar los retiros de esta cuenta (${borradoRetiros.error.message}). La cuenta NO se eliminó para evitar dejar datos huérfanos.`
      );
      return;
    }

    await supabase.from("achievements").update({ account_id: null }).eq("account_id", cuenta.id);

    const borradoCuenta = await supabase.from("accounts").delete().eq("id", cuenta.id);
    if (borradoCuenta.error) {
      setProcesando(false);
      setErrorEliminar(`No se pudo eliminar la cuenta (${borradoCuenta.error.message}).`);
      return;
    }

    setProcesando(false);
    setConfirmandoEliminar(false);
    onCambio();
  }

  return (
    <section className="overflow-hidden rounded-xl border border-kb-border bg-kb-surface">
      <div className={`h-1 w-full ${color.barra}`} />

      <div className="flex items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                cuenta.account_type === "real" ? "bg-kb-loss" : "bg-kb-gain"
              }`}
            />
            <h3 className="font-display text-base font-semibold text-kb-text">{cuenta.name}</h3>
            {cuenta.phase !== "no_aplica" && (
              <span className="rounded-full bg-kb-accent/10 px-2 py-0.5 text-[11px] font-medium text-kb-accent">
                {PHASE_LABELS[cuenta.phase]}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-kb-text-muted">
            {cuenta.broker ? `${cuenta.broker} · ` : ""}
            {cuenta.account_type === "real" ? "Cuenta real" : "Demo"} · Balance {formatCurrency(cuenta.starting_balance)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={onEditar}
            className="rounded-lg border border-kb-border p-1.5 text-kb-text-secondary hover:border-kb-accent hover:text-kb-accent transition-colors"
            aria-label="Editar cuenta"
            title="Editar"
          >
            ✎
          </button>
          <button
            onClick={archivar}
            disabled={procesando}
            className="rounded-lg border border-kb-border p-1.5 text-kb-text-secondary hover:text-kb-text transition-colors disabled:opacity-60"
            aria-label="Archivar cuenta"
            title="Archivar"
          >
            🗂
          </button>
          <button
            onClick={abrirConfirmacion}
            disabled={procesando}
            className="rounded-lg border border-kb-border p-1.5 text-kb-text-secondary hover:border-kb-loss hover:text-kb-loss transition-colors disabled:opacity-60"
            aria-label="Eliminar cuenta"
            title="Eliminar"
          >
            🗑
          </button>
        </div>
      </div>

      <div className="px-5 pb-4 pt-3">
        <p className="text-[10px] uppercase tracking-wide text-kb-text-secondary">P&amp;L acumulado</p>
        <p className={`font-mono text-xl font-bold leading-tight ${pnl >= 0 ? "text-kb-gain" : "text-kb-loss"}`}>
          {pnl >= 0 ? "+" : ""}
          {formatCurrency(pnl)}
        </p>

        {(cuenta.max_daily_loss || cuenta.max_total_loss) && (
          <p className="mt-1 text-[11px] text-kb-text-muted">
            {cuenta.max_daily_loss ? `Límite diario ${formatCurrency(cuenta.max_daily_loss)}` : ""}
            {cuenta.max_daily_loss && cuenta.max_total_loss ? " · " : ""}
            {cuenta.max_total_loss ? `Límite total ${formatCurrency(cuenta.max_total_loss)}` : ""}
          </p>
        )}

        {objetivoFaseMonto !== null && (cuenta.phase === "fase_1" || cuenta.phase === "fase_2") && (
          <div className="mt-2.5 rounded-lg border border-kb-border-soft bg-kb-bg p-2.5">
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="text-kb-text-secondary">
                Objetivo {PHASE_LABELS[cuenta.phase]}: {cuenta.phase_target_percent}% ({formatCurrency(objetivoFaseMonto)})
              </span>
              <span className="font-mono font-semibold text-kb-text">{progresoFasePorcentaje.toFixed(0)}%</span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-kb-border">
              <div
                className={`h-full rounded-full ${progresoFasePorcentaje >= 100 ? "bg-kb-gain" : "bg-kb-accent"}`}
                style={{ width: `${progresoFasePorcentaje}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 divide-x divide-kb-border-soft border-t border-kb-border-soft">
        <div className="px-3 py-3 text-center">
          <p className="text-[10px] uppercase tracking-wide text-kb-text-muted">Invertido</p>
          <p className="mt-0.5 font-mono text-sm font-semibold text-kb-text">{formatCurrency(invertido)}</p>
        </div>
        <div className="px-3 py-3 text-center">
          <p className="text-[10px] uppercase tracking-wide text-kb-text-muted">Retirado</p>
          <p className="mt-0.5 font-mono text-sm font-semibold text-kb-gain">
            {retirado > 0 ? formatCurrency(retirado) : "—"}
          </p>
        </div>
        <div className="px-3 py-3 text-center">
          <p className="text-[10px] uppercase tracking-wide text-kb-text-muted">Win rate</p>
          <p
            className={`mt-0.5 font-mono text-sm font-semibold ${
              winRate !== null ? (winRate >= 50 ? "text-kb-gain" : "text-kb-loss") : "text-kb-text"
            }`}
          >
            {winRate !== null ? `${winRate.toFixed(0)}%` : "—"}
          </p>
        </div>
      </div>

      {historial.length > 0 && (
        <div className="border-t border-kb-border-soft px-5 py-3">
          <p className="mb-1.5 text-[10px] uppercase tracking-wide text-kb-text-muted">Historial de fases</p>
          <div className="flex flex-wrap gap-1.5">
            {historial.map((h) => (
              <span
                key={h.id}
                className="rounded-full border border-kb-gain/30 bg-kb-gain/10 px-2 py-1 text-[11px] font-medium text-kb-gain"
                title={`Completada el ${formatDate(h.completado_en)}`}
              >
                ✓ {PHASE_LABELS[h.phase]} · +{formatCurrency(h.pnl_alcanzado)}
              </span>
            ))}
          </div>
        </div>
      )}

      {confirmandoEliminar && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={(e) =>
            manejarClickFondo(e, () => {
              setConfirmandoEliminar(false);
              setErrorEliminar(null);
            })
          }
        >
          <div className="w-full max-w-sm rounded-2xl border border-kb-border bg-kb-surface p-6 shadow-2xl">
            <h3 className="font-display text-lg font-bold text-kb-text">
              ¿Eliminar &quot;{cuenta.name}&quot;?
            </h3>
            <p className="mt-2 text-sm text-kb-text-secondary">
              Esta acción es <span className="font-semibold text-kb-loss">definitiva</span> y no
              se puede deshacer.
            </p>
            <div className="mt-3 rounded-lg border border-kb-loss/30 bg-kb-loss/10 px-3 py-2.5 text-sm">
              {cargandoConteo ? (
                <span className="text-kb-text-secondary">Revisando qué se va a borrar…</span>
              ) : (
                <span className="text-kb-loss">
                  Se van a borrar también{" "}
                  <span className="font-semibold">
                    {conteo?.trades ?? 0} operación{conteo?.trades === 1 ? "" : "es"}
                  </span>{" "}
                  y{" "}
                  <span className="font-semibold">
                    {conteo?.retiros ?? 0} retiro{conteo?.retiros === 1 ? "" : "s"}
                  </span>{" "}
                  registrados en esta cuenta.
                </span>
              )}
            </div>
            {errorEliminar && (
              <p className="mt-3 rounded-lg border border-kb-loss/30 bg-kb-loss/10 px-3 py-2 text-xs text-kb-loss">
                {errorEliminar}
              </p>
            )}
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => {
                  setConfirmandoEliminar(false);
                  setErrorEliminar(null);
                }}
                className="flex-1 rounded-lg border border-kb-border py-2 text-sm font-medium text-kb-text-secondary hover:text-kb-text transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={eliminar}
                disabled={procesando || cargandoConteo}
                className="flex-1 rounded-lg bg-kb-loss py-2 text-sm font-semibold text-white hover:brightness-110 transition disabled:opacity-60"
              >
                {procesando ? "Eliminando…" : "Sí, eliminar todo"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
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
  const [challengeType, setChallengeType] = useState<AccountChallengeType>(cuenta.challenge_type ?? "dos_fases");
  useCerrarConEscape(onClose);
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
  const [phaseTargetPercent, setPhaseTargetPercent] = useState(
    cuenta.phase_target_percent !== null ? String(cuenta.phase_target_percent) : ""
  );
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
        challenge_type: challengeType,
        starting_balance: balance,
        purchase_cost: purchaseCost.trim() === "" ? null : parseFloat(purchaseCost),
        max_daily_loss: maxDailyLoss.trim() === "" ? null : parseFloat(maxDailyLoss),
        max_total_loss: maxTotalLoss.trim() === "" ? null : parseFloat(maxTotalLoss),
        description: description.trim() === "" ? null : description.trim(),
        phase_target_percent: phaseTargetPercent.trim() === "" ? null : parseFloat(phaseTargetPercent),
        // Si cambiaste la fase a mano desde acá, reseteamos desde cuándo
        // se cuenta el progreso — para que no arrastre P&L de la fase
        // anterior como si fuera de la nueva.
        ...(phase !== cuenta.phase ? { phase_started_at: new Date().toISOString() } : {}),
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 overflow-y-auto"
      onClick={(e) => manejarClickFondo(e, onClose)}
    >
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

          <Campo etiqueta="Camino de fondeo">
            <select
              value={challengeType}
              onChange={(e) => setChallengeType(e.target.value as AccountChallengeType)}
              className={inputClass}
            >
              {(Object.entries(CHALLENGE_TYPE_LABELS) as [AccountChallengeType, string][]).map(
                ([valor, etiqueta]) => (
                  <option key={valor} value={valor}>{etiqueta}</option>
                )
              )}
            </select>
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

          {(phase === "fase_1" || phase === "fase_2") && (
            <Campo
              etiqueta="Objetivo de esta fase (%)"
              ayuda="Ej. 8 para un objetivo de 8% de ganancia. La app va a avisarte solo cuando lo alcances."
            >
              <input
                type="number"
                step="any"
                value={phaseTargetPercent}
                onChange={(e) => setPhaseTargetPercent(e.target.value)}
                placeholder="Ej. 8"
                className={inputClass}
              />
            </Campo>
          )}

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
  const [challengeType, setChallengeType] = useState<AccountChallengeType>("dos_fases");
  const [startingBalance, setStartingBalance] = useState("10000");
  const [purchaseCost, setPurchaseCost] = useState("");
  const [maxDailyLoss, setMaxDailyLoss] = useState("");
  const [maxTotalLoss, setMaxTotalLoss] = useState("");
  const [description, setDescription] = useState("");
  const [phaseTargetPercent, setPhaseTargetPercent] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useCerrarConEscape(onClose);

  // La fase inicial queda determinada por el tipo de cuenta elegido, para
  // que quede todo configurado de una sola vez: capital propio no tiene
  // fases, una cuenta instantánea ya nace fondeada, y los challenges
  // arrancan en Fase 1 (después la app misma detecta cuándo avanzan).
  const faseInicial: AccountPhase =
    challengeType === "capital_propio"
      ? "no_aplica"
      : challengeType === "instantanea"
      ? "financiada"
      : "fase_1";
  const necesitaObjetivo = challengeType === "una_fase" || challengeType === "dos_fases";

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
        challenge_type: challengeType,
        phase: faseInicial,
        starting_balance: balance,
        purchase_cost: purchaseCost.trim() === "" ? null : parseFloat(purchaseCost),
        max_daily_loss: maxDailyLoss.trim() === "" ? null : parseFloat(maxDailyLoss),
        max_total_loss: maxTotalLoss.trim() === "" ? null : parseFloat(maxTotalLoss),
        description: description.trim() === "" ? null : description.trim(),
        phase_target_percent: necesitaObjetivo && phaseTargetPercent.trim() !== "" ? parseFloat(phaseTargetPercent) : null,
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 overflow-y-auto"
      onClick={(e) => manejarClickFondo(e, onClose)}
    >
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

          <div>
            <span className="mb-1.5 block text-xs font-medium text-kb-text-secondary">
              ¿Qué camino recorre esta cuenta hasta estar fondeada?
            </span>
            <div className="grid grid-cols-2 gap-2">
              {(Object.entries(CHALLENGE_TYPE_LABELS) as [AccountChallengeType, string][]).map(
                ([valor, etiqueta]) => (
                  <button
                    key={valor}
                    type="button"
                    onClick={() => setChallengeType(valor)}
                    className={`rounded-lg border px-3 py-2.5 text-left text-xs font-medium transition-colors ${
                      challengeType === valor
                        ? "border-kb-accent bg-kb-accent/10 text-kb-accent"
                        : "border-kb-border text-kb-text-secondary hover:border-kb-text-secondary"
                    }`}
                  >
                    {etiqueta}
                  </button>
                )
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-kb-text-muted">
              {challengeType === "capital_propio" && "Sin fases — es tu propia plata, arranca sin objetivos de challenge."}
              {challengeType === "instantanea" && "Ya nace como cuenta financiada, sin pasos previos."}
              {challengeType === "una_fase" && "Arranca en Fase 1. Al lograr el objetivo, se marca directo como Financiada (sin Fase 2)."}
              {challengeType === "dos_fases" && "Arranca en Fase 1. Al lograr el objetivo pasa a Fase 2, y luego a Financiada."}
            </p>
          </div>

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

          {necesitaObjetivo && (
            <Campo
              etiqueta="Objetivo de la Fase 1 (%)"
              ayuda="Ej. 8 para un objetivo de 8% de ganancia. La app va a avisarte solo cuando lo alcances."
            >
              <input
                type="number"
                step="any"
                value={phaseTargetPercent}
                onChange={(e) => setPhaseTargetPercent(e.target.value)}
                placeholder="Ej. 8"
                className={inputClass}
              />
            </Campo>
          )}

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
  useCerrarConEscape(onClose);

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 overflow-y-auto"
      onClick={(e) => manejarClickFondo(e, onClose)}
    >
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

/**
 * Miniatura clickeable de una captura de pantalla subida como evidencia
 * de un trade (bucket privado "trade-evidence"). Al hacer clic abre la
 * imagen en tamaño completo en una pestaña nueva.
 */
function GaleriaImagenEvidencia({ ruta }: { ruta: string }) {
  const [urlFirmada, setUrlFirmada] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    async function cargar() {
      const rutaLimpia = extraerRutaStorage("trade-evidence", ruta);
      const { data } = await supabase.storage.from("trade-evidence").createSignedUrl(rutaLimpia, 3600);
      if (activo) setUrlFirmada(data?.signedUrl ?? null);
    }
    cargar();
    return () => {
      activo = false;
    };
  }, [ruta]);

  if (!urlFirmada) {
    return <SkeletonBloque className="h-24 w-full rounded-lg" />;
  }

  return (
    <a href={urlFirmada} target="_blank" rel="noopener noreferrer" className="block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={urlFirmada}
        alt="Captura de evidencia"
        className="h-24 w-full rounded-lg border border-kb-border-soft object-cover transition-opacity hover:opacity-80"
      />
    </a>
  );
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
  diaSeleccionado,
  onSeleccionarDia,
  onAbrirDia,
}: {
  trades: Trade[];
  diaSeleccionado: string;
  onSeleccionarDia: (clave: string) => void;
  onAbrirDia: (clave: string, tradesDelDia: Trade[]) => void;
}) {
  const [mesActual, setMesActual] = useState(() => {
    const hoy = new Date();
    return { year: hoy.getFullYear(), month: hoy.getMonth() };
  });

  const resumenPorDia = useMemo(() => {
    const mapa = new Map<string, ResumenDia>();
    trades
      .filter((t) => t.status === "closed" && t.realized_pnl !== null)
      .forEach((t) => {
        const clave = fechaKeyLocal(t.entry_time);
        const previo = mapa.get(clave) ?? { pnl: 0, cantidadTrades: 0 };
        mapa.set(clave, {
          pnl: previo.pnl + (t.realized_pnl ?? 0),
          cantidadTrades: previo.cantidadTrades + 1,
        });
      });
    return mapa;
  }, [trades]);

  // BUGFIX: se usa fechaKeyLocal() en vez de entry_time.slice(0, 10) para
  // que coincida exactamente con las claves de resumenPorDia (arriba) y
  // con las celdas del calendario, evitando el desfase de un día que se
  // producía en usuarios con huso horario negativo (ej. GMT-3).
  const diasConPendiente = useMemo(() => {
    const set = new Set<string>();
    trades
      .filter((t) => t.status === "open")
      .forEach((t) => set.add(fechaKeyLocal(t.entry_time)));
    return set;
  }, [trades]);

  const resumenDelMes = useMemo(() => {
    const { year, month } = mesActual;
    let pnl = 0;
    let diasOperados = 0;
    let diasGanadores = 0;
    resumenPorDia.forEach((resumen, clave) => {
      const [y, m] = clave.split("-").map(Number);
      if (y === year && m === month + 1) {
        pnl += resumen.pnl;
        diasOperados += 1;
        if (resumen.pnl > 0) diasGanadores += 1;
      }
    });
    return { pnl, diasOperados, diasGanadores };
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

  // Al hacer clic en un día, le avisamos al Dashboard qué operaciones
  // tenía ese día (si las tenía) para que decida qué "apartado" completo
  // mostrar: elegir entre varias, ver el detalle de una sola, o abrir el
  // formulario de registro si el día está vacío. Ya no se abre ninguna
  // ventana flotante desde acá.
  function manejarClickDia(clave: string) {
    const tradesDelDia = trades.filter((t) => fechaKeyLocal(t.entry_time) === clave);
    onSeleccionarDia(clave);
    onAbrirDia(clave, tradesDelDia);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-bold text-kb-text">Calendario de trading</h1>
        <p className="mt-0.5 text-sm text-kb-text-secondary">Tu resultado día por día, semana por semana.</p>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          etiqueta="Cierre del mes"
          valor={resumenDelMes.diasOperados > 0 ? formatCurrency(resumenDelMes.pnl) : "—"}
          tono={resumenDelMes.diasOperados > 0 ? (resumenDelMes.pnl >= 0 ? "gain" : "loss") : undefined}
        />
        <MetricCard etiqueta="Días operados" valor={String(resumenDelMes.diasOperados)} />
        <MetricCard
          etiqueta="Días en verde"
          valor={`${resumenDelMes.diasGanadores} / ${resumenDelMes.diasOperados}`}
          tono={resumenDelMes.diasGanadores > 0 ? "gain" : undefined}
        />
      </section>

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
                        ? "border-kb-gain/40 bg-kb-gain/15 text-kb-gain"
                        : "border-kb-loss/40 bg-kb-loss/15 text-kb-loss";
                  } else if (tienePendiente) {
                    estiloCelda = "border-kb-accent/40 bg-kb-accent/10 text-kb-accent";
                  }

                  return (
                    <button
                      key={celda.clave}
                      type="button"
                      onClick={() => manejarClickDia(celda.clave)}
                      className={`relative flex h-20 flex-col justify-between rounded-xl border p-2 text-left transition-colors cursor-pointer hover:brightness-125 sm:h-24 ${estiloCelda} ${
                        seleccionado ? "ring-2 ring-kb-accent" : ""
                      } ${esHoy ? "outline outline-2 outline-kb-accent/60" : ""}`}
                    >
                      {tienePendiente && <span className="absolute right-1.5 top-1.5 text-xs">🕐</span>}
                      <span className="block text-xs font-semibold">{celda.fecha.getDate()}</span>
                      {resumen && (
                        <div>
                          <span className="block font-mono text-sm font-bold leading-tight">
                            {resumen.pnl >= 0 ? "+" : ""}
                            {formatCurrency(resumen.pnl)}
                          </span>
                          <span className="block text-[10px] opacity-80">
                            {resumen.cantidadTrades} op{resumen.cantidadTrades === 1 ? "" : "s"}
                          </span>
                        </div>
                      )}
                    </button>
                  );
                })}

                <div
                  className={`flex h-20 w-20 flex-col items-center justify-center rounded-xl border text-center sm:h-24 ${
                    !semanaTuvoOperaciones
                      ? "border-kb-border-soft bg-kb-bg/40"
                      : totalSemana >= 0
                      ? "border-kb-gain/30 bg-kb-gain/10"
                      : "border-kb-loss/30 bg-kb-loss/10"
                  }`}
                >
                  <p className="text-[9px] uppercase tracking-wide text-kb-text-muted">Total</p>
                  {semanaTuvoOperaciones ? (
                    <span
                      className={`font-mono text-sm font-bold ${
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
      </section>
    </div>
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
  const [imagenesEvidencia, setImagenesEvidencia] = useState<File[]>([]);
  const [subiendoImagenes, setSubiendoImagenes] = useState(false);
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

    // Subimos las imágenes de evidencia primero (si hay), para guardar
    // sus rutas junto con el resto de la operación. El bucket es privado;
    // solo guardamos la ruta, la URL de acceso se genera al mostrarla.
    let rutasImagenes: string[] = [];
    if (imagenesEvidencia.length > 0) {
      setSubiendoImagenes(true);
      const subidas = await Promise.all(
        imagenesEvidencia.map(async (archivo) => {
          const nombreLimpio = archivo.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
          const ruta = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${nombreLimpio}`;
          const { error: uploadError } = await supabase.storage
            .from("trade-evidence")
            .upload(ruta, archivo);
          return uploadError ? null : ruta;
        })
      );
      rutasImagenes = subidas.filter((r): r is string => r !== null);
      setSubiendoImagenes(false);
    }

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
        evidence_images: rutasImagenes,
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
    setImagenesEvidencia([]);
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

          <div className="mt-4">
            <span className="mb-1 block text-xs font-medium text-kb-text-secondary">
              Capturas de pantalla (opcional)
            </span>
            <span className="mb-2 block text-[11px] text-kb-text-muted">
              Subí directamente una o varias imágenes del gráfico como evidencia — no hace
              falta que dependas de un link externo.
            </span>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                const archivos = Array.from(e.target.files ?? []);
                setImagenesEvidencia((prev) => [...prev, ...archivos]);
                e.target.value = "";
              }}
              className={`${inputClass} py-1.5`}
            />
            {imagenesEvidencia.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {imagenesEvidencia.map((archivo, i) => (
                  <span
                    key={i}
                    className="flex items-center gap-1.5 rounded-lg border border-kb-border-soft bg-kb-bg px-2.5 py-1.5 text-xs text-kb-text-secondary"
                  >
                    📷 {archivo.name.length > 20 ? archivo.name.slice(0, 20) + "…" : archivo.name}
                    <button
                      type="button"
                      onClick={() => setImagenesEvidencia((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-kb-text-muted hover:text-kb-loss transition-colors"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            {subiendoImagenes && (
              <p className="mt-2 text-xs text-kb-accent">Subiendo imágenes…</p>
            )}
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
  variante = "modal",
}: {
  trade: Trade;
  estrategias: Strategy[];
  onClose: () => void;
  onActualizado: () => void;
  onEliminado: () => void;
  /** "modal" = ventana flotante de siempre. "pagina" = se renderiza como
   * contenido normal a página completa, sin fondo oscuro ni superposición
   * — se usa cuando se accede desde el calendario para no interrumpir
   * con una ventana flotante. */
  variante?: "modal" | "pagina";
}) {
  const [modo, setModo] = useState<"ver" | "editar" | "cerrar" | "cerrar_parcial">("ver");
  // Solo cerramos con Escape en la variante "modal" (ventana flotante).
  // En la variante "pagina" no tiene sentido — ahí no hay nada flotando
  // que cerrar, y podría confundir si el usuario aprieta Escape mientras
  // escribe en un formulario.
  useCerrarConEscape(variante === "modal" ? onClose : () => {});

  // ---- Cierres parciales (escalado de salida) ----
  const [exits, setExits] = useState<TradeExit[]>([]);
  const [cargandoExits, setCargandoExits] = useState(true);

  async function cargarExits() {
    setCargandoExits(true);
    const { data } = await supabase
      .from("trade_exits")
      .select("*")
      .eq("trade_id", trade.id)
      .order("exit_time", { ascending: true });
    setExits((data as TradeExit[]) ?? []);
    setCargandoExits(false);
  }

  useEffect(() => {
    cargarExits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trade.id]);

  const cantidadCerradaParcial = exits.reduce((acc, e) => acc + e.quantity, 0);
  const cantidadRestante = Math.max(trade.quantity - cantidadCerradaParcial, 0);
  const tieneParciales = exits.length > 0;

  const rMultiple = calcularRMultiple(trade.realized_pnl, trade.risk_amount);
  const estrategiaNombre = estrategias.find((e) => e.id === trade.strategy_id)?.name ?? "Sin estrategia";
  const estaPendiente = trade.status === "open";

  const contenido = (
    <>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {variante === "pagina" && (
              <button
                onClick={onClose}
                className="mr-1 rounded-lg border border-kb-border px-2 py-1 text-xs text-kb-text-secondary hover:border-kb-accent hover:text-kb-accent transition-colors"
              >
                ← Volver
              </button>
            )}
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
          {variante === "modal" && (
            <button onClick={onClose} className="text-kb-text-muted hover:text-kb-text transition" aria-label="Cerrar">
              ✕
            </button>
          )}
        </div>

        {modo === "cerrar" ? (
          <FormularioCerrarTrade
            trade={trade}
            pnlParcialesPrevios={exits.reduce((acc, e) => acc + e.pnl, 0)}
            onCancelar={() => setModo("ver")}
            onCerrado={onActualizado}
          />
        ) : modo === "cerrar_parcial" ? (
          <FormularioCierreParcial
            trade={trade}
            cantidadRestante={cantidadRestante}
            onCancelar={() => setModo("ver")}
            onParcialGuardado={async () => {
              await cargarExits();
              setModo("ver");
            }}
            onCerradoCompleto={onActualizado}
          />
        ) : modo === "ver" && estaPendiente ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-dashed border-kb-accent/40 bg-kb-accent/10 p-4 text-center">
              <p className="text-sm font-medium text-kb-accent">
                Esta operación todavía está abierta — registrala como cerrada cuando termine.
              </p>
            </div>

            {!cargandoExits && tieneParciales && (
              <div className="rounded-lg border border-kb-border-soft bg-kb-bg p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold text-kb-text">
                    Cerrado parcialmente: {cantidadCerradaParcial} de {trade.quantity}
                  </p>
                  <p className="text-xs font-mono text-kb-text-secondary">
                    {((cantidadCerradaParcial / trade.quantity) * 100).toFixed(0)}%
                  </p>
                </div>
                <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-kb-border">
                  <div
                    className="h-full bg-kb-accent"
                    style={{ width: `${Math.min((cantidadCerradaParcial / trade.quantity) * 100, 100)}%` }}
                  />
                </div>
                <ul className="space-y-1.5">
                  {exits.map((e) => (
                    <li key={e.id} className="flex items-center justify-between text-xs">
                      <span className="text-kb-text-secondary">
                        {e.quantity} @ {formatPrice(e.exit_price)} · {formatDate(e.exit_time)}
                      </span>
                      <span className={`font-mono font-semibold ${e.pnl >= 0 ? "text-kb-gain" : "text-kb-loss"}`}>
                        {formatCurrency(e.pnl)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-kb-text-muted">
                  Quedan {cantidadRestante} sin cerrar. El trade pasa a "cerrado" y entra en tus
                  métricas recién cuando se cierre el 100% de la posición.
                </p>
              </div>
            )}

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
                ✅ Cerrar {tieneParciales ? "el resto" : "operación"}
              </button>
              <button
                onClick={() => setModo("cerrar_parcial")}
                className="flex-1 rounded-lg border border-kb-accent/40 py-2.5 text-sm font-medium text-kb-accent hover:bg-kb-accent/10 transition-colors"
              >
                📐 Cerrar parcial
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
                  Links {trade.tradingview_links.length > 1 ? `(${trade.tradingview_links.length} temporalidades)` : ""}
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

            {trade.evidence_images && trade.evidence_images.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-kb-text-secondary">
                  Capturas ({trade.evidence_images.length})
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {trade.evidence_images.map((ruta, i) => (
                    <GaleriaImagenEvidencia key={i} ruta={ruta} />
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setModo("editar")}
                className="flex-1 rounded-lg border border-kb-border py-2.5 text-sm font-medium text-kb-text hover:border-kb-accent hover:text-kb-accent transition-colors"
              >
                ✎ Editar operación
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
    </>
  );

  if (variante === "pagina") {
    return <div className="rounded-2xl border border-kb-border bg-kb-surface p-6">{contenido}</div>;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 overflow-y-auto"
      onClick={(e) => manejarClickFondo(e, onClose)}
    >
      <div className="w-full max-h-[85vh] max-w-lg overflow-y-auto rounded-2xl border border-kb-border bg-kb-surface p-6 shadow-2xl">
        {contenido}
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
  pnlParcialesPrevios = 0,
  onCancelar,
  onCerrado,
}: {
  trade: Trade;
  pnlParcialesPrevios?: number;
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
          // El P&L final suma lo que ya se había asegurado en cierres
          // parciales anteriores (si los hubo) más el resultado de este
          // último tramo, y recién ahí se resta la comisión total.
          realized_pnl: Math.round((pnlParcialesPrevios + pnlNumero - comisiones) * 100) / 100,
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

      {pnlParcialesPrevios !== 0 && (
        <p className="rounded-lg border border-kb-accent/30 bg-kb-accent/10 px-3 py-2 text-xs text-kb-accent">
          Ya tenés {formatCurrency(pnlParcialesPrevios)} asegurados de cierres parciales
          anteriores — se van a sumar automáticamente al P&amp;L que pongas abajo.
        </p>
      )}

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

// =====================================================================
// FORMULARIO: cerrar solo una PORCIÓN de una posición abierta (escalado
// de salida). Guarda el registro en "trade_exits" y, si con este cierre
// se completa el 100% de la cantidad original, finaliza el trade
// completo (status "closed", con el P&L total sumado de todos los
// tramos y el precio de salida promediado por cantidad).
// =====================================================================

function FormularioCierreParcial({
  trade,
  cantidadRestante,
  onCancelar,
  onParcialGuardado,
  onCerradoCompleto,
}: {
  trade: Trade;
  cantidadRestante: number;
  onCancelar: () => void;
  onParcialGuardado: () => void;
  onCerradoCompleto: () => void;
}) {
  const [cantidad, setCantidad] = useState(String(cantidadRestante));
  const [exitPrice, setExitPrice] = useState("");
  const [pnlManual, setPnlManual] = useState("");
  const [notas, setNotas] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const cantidadNumero = parseFloat(cantidad);
    const precioSalida = parseFloat(exitPrice);
    const pnlNumero = parseFloat(pnlManual);

    if (Number.isNaN(cantidadNumero) || cantidadNumero <= 0) {
      setError("La cantidad a cerrar debe ser un número mayor a cero.");
      return;
    }
    if (cantidadNumero > cantidadRestante + 0.0000001) {
      setError(`No podés cerrar más de lo que queda abierto (${cantidadRestante}).`);
      return;
    }
    if (Number.isNaN(precioSalida) || Number.isNaN(pnlNumero)) {
      setError("Precio de salida y P&L de este tramo son obligatorios y deben ser números.");
      return;
    }

    setEnviando(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setEnviando(false);
      setError("Tu sesión expiró. Vuelve a iniciar sesión.");
      return;
    }

    const ahora = new Date().toISOString();
    const { error: insertError } = await conReintento(() =>
      supabase.from("trade_exits").insert({
        trade_id: trade.id,
        user_id: userId,
        quantity: cantidadNumero,
        exit_price: precioSalida,
        pnl: pnlNumero,
        exit_time: ahora,
        notes: notas.trim() === "" ? null : notas.trim(),
      })
    );

    if (insertError) {
      setEnviando(false);
      setError(
        `No se pudo guardar el cierre parcial (lo intentamos dos veces). Detalle: ${insertError.message}`
      );
      return;
    }

    const cantidadRestanteDespues = cantidadRestante - cantidadNumero;

    // Si con este tramo se cierra el 100% de la posición, finalizamos el
    // trade: traemos todos sus cierres parciales (incluido este que
    // acabamos de insertar), promediamos el precio de salida ponderado
    // por cantidad, y sumamos todos los P&L para el resultado final.
    if (cantidadRestanteDespues <= 0.0000001) {
      const { data: todosLosExits } = await supabase
        .from("trade_exits")
        .select("*")
        .eq("trade_id", trade.id);

      const exitsFinal = (todosLosExits as TradeExit[]) ?? [];
      const cantidadTotal = exitsFinal.reduce((acc, ex) => acc + ex.quantity, 0);
      const precioPromedio =
        cantidadTotal > 0
          ? exitsFinal.reduce((acc, ex) => acc + ex.exit_price * ex.quantity, 0) / cantidadTotal
          : precioSalida;
      const pnlTotal = exitsFinal.reduce((acc, ex) => acc + ex.pnl, 0);
      const ultimoExitTime = exitsFinal.reduce(
        (acc, ex) => (new Date(ex.exit_time).getTime() > new Date(acc).getTime() ? ex.exit_time : acc),
        ahora
      );

      const { error: updateError } = await supabase
        .from("trades")
        .update({
          status: "closed",
          exit_price: Math.round(precioPromedio * 100000) / 100000,
          realized_pnl: Math.round((pnlTotal - (trade.fees ?? 0)) * 100) / 100,
          result_type: "manual",
          exit_time: ultimoExitTime,
        })
        .eq("id", trade.id);

      setEnviando(false);

      if (updateError) {
        setError(`El cierre parcial se guardó, pero no se pudo finalizar el trade: ${updateError.message}`);
        return;
      }
      onCerradoCompleto();
      return;
    }

    setEnviando(false);
    onParcialGuardado();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-kb-text-secondary">
        Cerrá una parte de <span className="font-semibold text-kb-text">{trade.symbol}</span> —
        quedan <span className="font-semibold text-kb-text">{cantidadRestante}</span> sin cerrar
        todavía.
      </p>

      <Campo etiqueta="Cantidad a cerrar ahora" ayuda={`Máximo: ${cantidadRestante}`}>
        <input
          required
          type="number"
          step="any"
          max={cantidadRestante}
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
          className={inputClass}
        />
      </Campo>

      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Precio de salida de este tramo">
          <input
            required
            type="number"
            step="any"
            value={exitPrice}
            onChange={(e) => setExitPrice(e.target.value)}
            className={inputClass}
          />
        </Campo>
        <Campo etiqueta="P&L de este tramo">
          <input
            required
            type="number"
            step="any"
            value={pnlManual}
            onChange={(e) => setPnlManual(e.target.value)}
            placeholder="Ej. 120 o -40"
            className={inputClass}
          />
        </Campo>
      </div>

      <Campo etiqueta="Notas (opcional)" ayuda="Ej. 'Aseguré breakeven', 'Primer target 1:1'">
        <input value={notas} onChange={(e) => setNotas(e.target.value)} className={inputClass} />
      </Campo>

      {cantidadRestante - (parseFloat(cantidad) || 0) <= 0.0000001 && (
        <p className="rounded-lg border border-kb-gain/30 bg-kb-gain/10 px-3 py-2 text-xs text-kb-gain">
          Con esta cantidad cerrás el 100% de la posición — el trade va a quedar marcado como
          cerrado y va a entrar en tus métricas.
        </p>
      )}

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
          {enviando ? "Guardando…" : "Registrar cierre parcial"}
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
  const [imagenesExistentes, setImagenesExistentes] = useState<string[]>(trade.evidence_images ?? []);
  const [imagenesNuevas, setImagenesNuevas] = useState<File[]>([]);
  const [subiendoImagenes, setSubiendoImagenes] = useState(false);
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

    // Subimos las imágenes nuevas que se hayan agregado en esta edición y
    // las combinamos con las que ya tenía el trade (menos las que se
    // hayan quitado desde imagenesExistentes).
    let rutasNuevas: string[] = [];
    if (imagenesNuevas.length > 0) {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (userId) {
        setSubiendoImagenes(true);
        const subidas = await Promise.all(
          imagenesNuevas.map(async (archivo) => {
            const nombreLimpio = archivo.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
            const ruta = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${nombreLimpio}`;
            const { error: uploadError } = await supabase.storage
              .from("trade-evidence")
              .upload(ruta, archivo);
            return uploadError ? null : ruta;
          })
        );
        rutasNuevas = subidas.filter((r): r is string => r !== null);
        setSubiendoImagenes(false);
      }
    }

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
        evidence_images: [...imagenesExistentes, ...rutasNuevas],
        notes: notes.trim() === "" ? null : notes.trim(),
      })
      .eq("id", trade.id);
    setEnviando(false);

    if (updateError) {
      setError("No se pudo guardar los cambios. Intenta de nuevo.");
      return;
    }

    // Si el usuario sacó alguna imagen existente durante la edición, la
    // borramos del Storage también — si no, queda ocupando espacio sin
    // que ningún trade la referencie más.
    const imagenesEliminadas = (trade.evidence_images ?? []).filter(
      (r) => !imagenesExistentes.includes(r)
    );
    if (imagenesEliminadas.length > 0) {
      const rutas = imagenesEliminadas.map((r) => extraerRutaStorage("trade-evidence", r));
      await supabase.storage.from("trade-evidence").remove(rutas);
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

      <div>
        <span className="mb-1 block text-xs font-medium text-kb-text-secondary">Capturas de pantalla</span>
        {imagenesExistentes.length > 0 && (
          <div className="mb-2 grid grid-cols-4 gap-2">
            {imagenesExistentes.map((ruta, i) => (
              <div key={ruta} className="relative">
                <ImagenPrivada
                  bucket="trade-evidence"
                  path={ruta}
                  alt="Captura de evidencia"
                  className="h-16 w-full rounded-lg border border-kb-border-soft object-cover"
                />
                <button
                  type="button"
                  onClick={() => setImagenesExistentes((prev) => prev.filter((_, idx) => idx !== i))}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-kb-loss text-[10px] text-white"
                  aria-label="Quitar imagen"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => {
            const archivos = Array.from(e.target.files ?? []);
            setImagenesNuevas((prev) => [...prev, ...archivos]);
            e.target.value = "";
          }}
          className={`${inputClass} py-1.5`}
        />
        {imagenesNuevas.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {imagenesNuevas.map((archivo, i) => (
              <span
                key={i}
                className="flex items-center gap-1.5 rounded-lg border border-kb-border-soft bg-kb-bg px-2.5 py-1.5 text-xs text-kb-text-secondary"
              >
                📷 {archivo.name.length > 20 ? archivo.name.slice(0, 20) + "…" : archivo.name}
                <button
                  type="button"
                  onClick={() => setImagenesNuevas((prev) => prev.filter((_, idx) => idx !== i))}
                  className="text-kb-text-muted hover:text-kb-loss transition-colors"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        {subiendoImagenes && <p className="mt-2 text-xs text-kb-accent">Subiendo imágenes…</p>}
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