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
  type Investment,
  type InvestmentType,
  INVESTMENT_TYPE_LABELS,
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
 * Anima un número desde su valor anterior hasta el nuevo, en vez de
 * "saltar" de golpe. Se usa en los números más importantes (balance,
 * P&L, puntaje) para que la app se sienta viva cuando algo cambia, en
 * vez de estática. La duración es corta (500ms) para que no se sienta
 * lenta al navegar entre vistas.
 */
function useNumeroAnimado(valorFinal: number, duracionMs = 500): number {
  const [valorMostrado, setValorMostrado] = useState(valorFinal);
  const valorAnteriorRef = useRef(valorFinal);

  useEffect(() => {
    const desde = valorAnteriorRef.current;
    const hasta = valorFinal;
    if (desde === hasta) return;

    const inicio = performance.now();
    let frameId: number;

    function tick(ahora: number) {
      const progreso = Math.min((ahora - inicio) / duracionMs, 1);
      // easeOutCubic: arranca rápido y frena suave al final, se siente más natural que lineal.
      const suavizado = 1 - Math.pow(1 - progreso, 3);
      setValorMostrado(desde + (hasta - desde) * suavizado);
      if (progreso < 1) frameId = requestAnimationFrame(tick);
      else valorAnteriorRef.current = hasta;
    }

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [valorFinal, duracionMs]);

  return valorMostrado;
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
 * Devuelve el offset UTC local del navegador como string con signo,
 * ej. "-03:00" o "+00:00". Se usa para construir rangos de fecha en
 * Supabase que respeten la zona horaria real del usuario en vez de
 * tener el offset hardcodeado.
 */
function tzOffsetLocal(): string {
  const off = new Date().getTimezoneOffset(); // minutos, positivo = atrás de UTC
  const sign = off <= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
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
 * Stack global de handlers de Escape. Cuando varios componentes usan
 * useCerrarConEscape al mismo tiempo (ej. un modal encima de una tarjeta
 * expandida), solo debe cerrarse el que esté "más arriba" — el último en
 * montarse. El stack garantiza que solo el handler más reciente responde.
 */
const escapeHandlerStack: (() => void)[] = [];

/**
 * Hace que cualquier modal se cierre al apretar la tecla Escape — antes
 * había que buscar la "✕" o un botón "Cancelar" sí o sí. Se usa junto
 * con onClick en el fondo oscuro (backdrop) para que también se cierre
 * al hacer clic afuera de la tarjeta del modal.
 *
 * BUG-6 fix: usa un stack global para que solo el handler más reciente
 * (el panel/modal que está "encima de todo") capture el Escape, evitando
 * que múltiples componentes montados simultáneamente todos se cierren a la vez.
 */
function useCerrarConEscape(onClose: () => void) {
  // Guardamos siempre la versión más reciente de onClose en un ref para
  // evitar el problema de "stale closure": el listener se registra una
  // sola vez ([] como dependencia) pero siempre llama a la función actual.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    // `invocar` es una función estable (misma referencia durante toda la vida
    // del componente) — la usamos como identidad dentro del stack.
    const invocar = () => onCloseRef.current();
    escapeHandlerStack.push(invocar);

    function manejarTecla(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Solo dispara si este componente es el que está más arriba en el stack
      if (escapeHandlerStack[escapeHandlerStack.length - 1] === invocar) {
        invocar();
      }
    }

    window.addEventListener("keydown", manejarTecla);
    return () => {
      window.removeEventListener("keydown", manejarTecla);
      // Sacar este handler del stack al desmontar el componente
      const idx = escapeHandlerStack.lastIndexOf(invocar);
      if (idx !== -1) escapeHandlerStack.splice(idx, 1);
    };
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

/** Maneja el tema oscuro/claro de toda la app: lo guarda en localStorage y lo aplica como clase en <html>, para que todas las variables de color de globals.css cambien solas. */
function useTema() {
  const [tema, setTema] = useState<"oscuro" | "claro">("oscuro");

  useEffect(() => {
    const guardado = typeof window !== "undefined" ? window.localStorage.getItem("kebotrader_tema") : null;
    const inicial = guardado === "claro" ? "claro" : "oscuro";
    setTema(inicial);
    document.documentElement.classList.toggle("light", inicial === "claro");
  }, []);

  function alternarTema() {
    setTema((prev) => {
      const nuevo = prev === "oscuro" ? "claro" : "oscuro";
      document.documentElement.classList.toggle("light", nuevo === "claro");
      window.localStorage.setItem("kebotrader_tema", nuevo);
      return nuevo;
    });
  }

  return { tema, alternarTema };
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const { tema, alternarTema } = useTema();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCheckingSession(false);
    }).catch(() => {
      setCheckingSession(false); // evita pantalla de carga infinita si falla
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

  return session ? (
    <Dashboard session={session} tema={tema} alternarTema={alternarTema} />
  ) : (
    <LandingConAuth tema={tema} alternarTema={alternarTema} />
  );
}

// =====================================================================
// LANDING PAGE + AUTENTICACIÓN (usuario no logueado)
// =====================================================================

function LandingConAuth({
  tema,
  alternarTema,
}: {
  tema: "oscuro" | "claro";
  alternarTema: () => void;
}) {
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
          <div className="flex items-center gap-2">
            <button
              onClick={alternarTema}
              aria-label="Cambiar tema"
              className="rounded-lg border border-kb-border p-2 text-sm text-kb-text-secondary hover:border-kb-accent hover:text-kb-accent transition-colors"
            >
              {tema === "oscuro" ? "☀️" : "🌙"}
            </button>
            <button
              onClick={() => setMostrarAuth(true)}
              className="rounded-lg border border-kb-border px-4 py-2 text-sm font-medium text-kb-text hover:border-kb-accent hover:text-kb-accent transition-colors"
            >
              Iniciar sesión
            </button>
          </div>
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

      {/* ---------- Vistazo del interior — sin necesitar cuenta ---------- */}
      <section className="mx-auto max-w-6xl px-6 py-16 border-b border-kb-border-soft">
        <div className="mb-8 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-kb-accent">Sin registrarte</p>
          <h2 className="mt-1 font-display text-2xl sm:text-3xl font-bold">Así se ve por dentro</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-kb-text-secondary">
            Un vistazo real del Dashboard, con datos de ejemplo — así sabés exactamente qué vas a
            encontrar antes de crear tu cuenta.
          </p>
        </div>

        {/* "Marco de navegador" para que se sienta como una captura real de la app */}
        <div className="mx-auto max-w-3xl overflow-hidden rounded-xl border border-kb-border shadow-2xl">
          <div className="flex items-center gap-1.5 border-b border-kb-border-soft bg-kb-surface px-3 py-2">
            <span className="h-2.5 w-2.5 rounded-full bg-kb-loss/60" />
            <span className="h-2.5 w-2.5 rounded-full bg-kb-accent/60" />
            <span className="h-2.5 w-2.5 rounded-full bg-kb-gain/60" />
            <span className="ml-3 rounded-md bg-kb-bg px-2 py-0.5 font-mono text-[10px] text-kb-text-muted">
              kebotrader.vercel.app/dashboard
            </span>
          </div>

          <div className="space-y-4 bg-kb-bg p-4 sm:p-6">
            {/* Saludo */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-kb-accent">Sesión activa</p>
              <p className="font-display text-lg font-bold text-kb-text">Hola, Trader</p>
            </div>

            {/* Fila: puntaje + comparación mensual, como en el Dashboard real */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-kb-border bg-kb-surface p-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-kb-text-secondary">
                  🎯 Puntaje KeboTrader
                </p>
                <div className="flex items-center gap-3">
                  <p className="font-mono text-3xl font-bold text-kb-gain">78<span className="text-sm text-kb-text-muted">/100</span></p>
                  <div className="flex-1 space-y-1.5">
                    <div className="h-1 w-full rounded-full bg-kb-border">
                      <div className="h-full w-[70%] rounded-full bg-kb-gain" />
                    </div>
                    <div className="h-1 w-full rounded-full bg-kb-border">
                      <div className="h-full w-[85%] rounded-full bg-kb-accent" />
                    </div>
                    <div className="h-1 w-full rounded-full bg-kb-border">
                      <div className="h-full w-[60%] rounded-full bg-kb-gain" />
                    </div>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-kb-border bg-kb-surface p-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-kb-text-secondary">
                  📊 Este mes vs. el anterior
                </p>
                <p className="font-mono text-2xl font-bold text-kb-gain">+$1.240,00</p>
                <p className="mt-1 text-[11px] font-medium text-kb-gain">▲ $380,00 mejor que el mes pasado</p>
              </div>
            </div>

            {/* P&L total con medidor de arco */}
            <div className="rounded-xl border border-kb-border bg-kb-surface p-4">
              <div className="flex items-center gap-4">
                <svg viewBox="0 0 168 96" className="w-[110px] shrink-0">
                  <path d="M 24 88 A 60 60 0 0 1 144 88" fill="none" stroke="var(--kb-loss)" strokeWidth="12" strokeLinecap="round" opacity="0.3" />
                  <path d="M 24 88 A 60 60 0 0 1 144 88" fill="none" stroke="var(--kb-gain)" strokeWidth="12" strokeLinecap="round" strokeDasharray="145 188" />
                </svg>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-kb-text-secondary">P&amp;L total</p>
                  <p className="font-mono text-2xl font-bold text-kb-gain">+$3.180,50</p>
                  <p className="text-[11px] text-kb-text-muted">64.2% win rate · 47 trades</p>
                </div>
              </div>
            </div>

            {/* Mini calendario */}
            <div className="rounded-xl border border-kb-border bg-kb-surface p-4">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-kb-text-secondary">Calendario</p>
              <div className="grid grid-cols-7 gap-1">
                {[
                  0, 0, 120, -40, 0, 260, 0,
                  80, 0, -60, 310, 0, 0, 150,
                  0, 90, -20, 0, 400, 0, 60,
                ].map((v, i) => (
                  <div
                    key={i}
                    className={`flex h-7 items-center justify-center rounded-md text-[9px] font-mono ${
                      v === 0
                        ? "bg-kb-bg text-kb-text-muted"
                        : v > 0
                        ? "bg-kb-gain/20 text-kb-gain"
                        : "bg-kb-loss/20 text-kb-loss"
                    }`}
                  >
                    {v !== 0 ? Math.abs(v) : ""}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-kb-text-muted">
          * Datos de ejemplo, para que veas el diseño real — tu Dashboard va a mostrar tus propios números.
        </p>
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
  const [nombre, setNombre] = useState("");
  const [codigoAcceso, setCodigoAcceso] = useState("");
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
        // El registro está cerrado por ahora — solo entra quien tenga
        // el código que vos le diste a mano. Se verifica en el
        // servidor (no en el navegador) para que el código no quede
        // visible en el código fuente de la página.
        const respuestaCodigo = await fetch("/api/verificar-codigo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ codigo: codigoAcceso.trim() }),
        });
        const datosCodigo = await respuestaCodigo.json();
        if (!datosCodigo.valido) {
          throw new Error("Ese código de acceso no es válido. Pedile el correcto a quien te invitó.");
        }

        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          // El nombre se guarda en los metadatos de la cuenta — esto
          // funciona aunque todavía no haya sesión activa (antes de
          // confirmar el correo). La primera vez que inicie sesión de
          // verdad, el Dashboard lo copia a la tabla "profiles".
          options: { data: { display_name: nombre.trim() } },
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
          {modo === "registro" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-kb-text-secondary">
                ¿Cómo te llamás?
              </label>
              <input
                required
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                className="w-full rounded-lg border border-kb-border bg-kb-bg px-3 py-2 text-sm text-kb-text outline-none focus:border-kb-accent"
                placeholder="Ej. Juan Pérez"
              />
            </div>
          )}

          {modo === "registro" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-kb-text-secondary">
                Código de acceso
              </label>
              <input
                required
                value={codigoAcceso}
                onChange={(e) => setCodigoAcceso(e.target.value)}
                className="w-full rounded-lg border border-kb-border bg-kb-bg px-3 py-2 text-sm text-kb-text outline-none focus:border-kb-accent"
                placeholder="Pedíselo a quien te invitó"
              />
              <p className="mt-1 text-[11px] text-kb-text-muted">
                Por ahora el registro es solo por invitación.
              </p>
            </div>
          )}

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
  | "aportes"
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

/**
 * Set de íconos SVG propio para el menú de navegación — trazo fino
 * consistente (2px, sin relleno), en vez de emojis. Es la parte de la
 * app que más tiempo está a la vista, así que es donde más se nota
 * mezclar un estilo de emoji con otro más "producto serio".
 */
function IconoNav({ id, className = "h-[18px] w-[18px]" }: { id: Vista; className?: string }) {
  const props = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (id) {
    case "inicio":
      return (
        <svg {...props}>
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      );
    case "historial":
      return (
        <svg {...props}>
          <polyline points="3,17 9,11 13,15 21,6" />
          <polyline points="15,6 21,6 21,12" />
        </svg>
      );
    case "calendario":
      return (
        <svg {...props}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <line x1="3" y1="10" x2="21" y2="10" />
          <line x1="8" y1="3" x2="8" y2="7" />
          <line x1="16" y1="3" x2="16" y2="7" />
        </svg>
      );
    case "reportes":
      return (
        <svg {...props}>
          <line x1="5" y1="21" x2="5" y2="11" />
          <line x1="12" y1="21" x2="12" y2="5" />
          <line x1="19" y1="21" x2="19" y2="14" />
        </svg>
      );
    case "estrategias":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="4.5" />
          <circle cx="12" cy="12" r="0.8" fill="currentColor" />
        </svg>
      );
    case "configuracion":
      return (
        <svg {...props}>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M4.5 20c0-4 3.5-6.5 7.5-6.5s7.5 2.5 7.5 6.5" />
        </svg>
      );
    case "roi":
      return (
        <svg {...props}>
          <line x1="12" y1="2.5" x2="12" y2="21.5" />
          <path d="M17 6.5c0-1.8-2.2-3-5-3s-5 1.3-5 3 2.2 2.7 5 3 5 1.2 5 3-2.2 3-5 3-5-1.2-5-3" />
        </svg>
      );
    case "retiros":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <polyline points="12,7 12,12 16,14" />
        </svg>
      );
    case "logros":
      return (
        <svg {...props}>
          <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
          <path d="M7 6H4.5A1.5 1.5 0 0 0 3 7.5C3 9.5 4.5 11 7 11" />
          <path d="M17 6h2.5A1.5 1.5 0 0 1 21 7.5c0 2-1.5 3.5-4 3.5" />
          <line x1="12" y1="14.2" x2="12" y2="17.5" />
          <path d="M8.5 20.5h7" />
          <line x1="12" y1="17.5" x2="12" y2="20.5" />
        </svg>
      );
    case "importar":
      return (
        <svg {...props}>
          <path d="M12 16V4" />
          <polyline points="7,8.5 12,3.5 17,8.5" />
          <path d="M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15" />
        </svg>
      );
    case "perfil":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </svg>
      );
    default:
      return null;
  }
}


const NAV_GRUPOS: NavGrupo[] = [
  {
    titulo: "General",
    items: [
      { id: "inicio", etiqueta: "Dashboard", icono: "📊" },
      { id: "historial", etiqueta: "Trades", icono: "📈" },
      { id: "calendario", etiqueta: "Calendario", icono: "📅" },
      { id: "reportes", etiqueta: "Estadísticas", icono: "📉" },
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
    items: [
      { id: "perfil", etiqueta: "Perfil", icono: "⚙️" },
    ],
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
  retiradoPorCuenta,
  onSeleccionar,
  onNuevaCuenta,
}: {
  cuentas: Account[];
  cargando: boolean;
  cuentaActivaId: CuentaSeleccion;
  pnlPorCuenta: Map<string, number>;
  retiradoPorCuenta: Map<string, number>;
  onSeleccionar: (id: CuentaSeleccion) => void;
  onNuevaCuenta: () => void;
}) {
  const [abierto, setAbierto] = useState(false);

  const equityTotal = cuentas.reduce(
    (acc, c) =>
      acc +
      c.starting_balance +
      (pnlPorCuenta.get(c.id) ?? 0) -
      (retiradoPorCuenta.get(c.id) ?? 0),
    0
  );

  const cuentaActiva = cuentaActivaId === "todas" ? null : cuentas.find((c) => c.id === cuentaActivaId);
  const equityMostrado =
    cuentaActivaId === "todas"
      ? equityTotal
      : cuentaActiva
      ? cuentaActiva.starting_balance +
        (pnlPorCuenta.get(cuentaActiva.id) ?? 0) -
        (retiradoPorCuenta.get(cuentaActiva.id) ?? 0)
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
            const pnl = (pnlPorCuenta.get(c.id) ?? 0) - (retiradoPorCuenta.get(c.id) ?? 0);
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

// =====================================================================
// PANTALLA: iniciar prueba con tarjeta — se muestra en vez de toda la
// app hasta que el usuario complete el checkout de Stripe. No se puede
// "saltear": es la puerta de entrada obligatoria a KeboTrader.
// =====================================================================

function Dashboard({
  session,
  tema,
  alternarTema,
}: {
  session: Session;
  tema: "oscuro" | "claro";
  alternarTema: () => void;
}) {
  const [vista, setVista] = useState<Vista>("inicio");
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false);

  // Nombre real del perfil (si lo cargaste en Perfil, o si lo pusiste al
  // registrarte) — se usa en el saludo del Dashboard y en el sidebar,
  // en vez de siempre derivarlo del email.
  const [nombrePerfil, setNombrePerfil] = useState<string | null>(null);

  useEffect(() => {
    async function cargarNombrePerfil() {
      const { data } = await supabase.from("profiles").select("display_name").eq("id", session.user.id).maybeSingle();
      const nombreGuardado = (data as { display_name: string | null } | null)?.display_name;

      if (nombreGuardado && nombreGuardado.trim() !== "") {
        setNombrePerfil(nombreGuardado.trim());
        return;
      }

      // Si todavía no hay nombre en "profiles", pero sí quedó guardado
      // en los metadatos al registrarse (ver ModalAuth), lo usamos y
      // aprovechamos para copiarlo a "profiles" — ahora sí hay sesión
      // válida para escribir, así que en el próximo login ya lo lee
      // directo de ahí.
      const nombreDeMetadatos = session.user.user_metadata?.display_name as string | undefined;
      if (nombreDeMetadatos && nombreDeMetadatos.trim() !== "") {
        setNombrePerfil(nombreDeMetadatos.trim());
        await supabase.from("profiles").upsert({ id: session.user.id, display_name: nombreDeMetadatos.trim() });
      }
    }
    cargarNombrePerfil();
  }, [session.user.id]);

  const nombreParaMostrar = nombrePerfil ?? nombreDesdeEmail(session.user.email);

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
  const [aportes, setAportes] = useState<Investment[]>([]);
  const [cargandoAportes, setCargandoAportes] = useState(false);
  const [cargandoRetiros, setCargandoRetiros] = useState(true);

  const [logros, setLogros] = useState<Achievement[]>([]);
  const [cargandoLogros, setCargandoLogros] = useState(true);

  const [historialFases, setHistorialFases] = useState<PhaseHistoryEntry[]>([]);

  async function cargarCuentas() {
    setCargandoCuentas(true);
    const { data, error } = await supabase
      .from("accounts")
      .select("*")
      .eq("is_archived", false)
      .order("created_at", { ascending: true });

    if (!error) {
      setCuentas((data as Account[]) ?? []);
    }
    setCargandoCuentas(false);
  }

  async function cargarHistorialFases() {
    const { data, error } = await supabase
      .from("phase_history")
      .select("*")
      .order("completado_en", { ascending: false });
    if (!error) {
      setHistorialFases((data as PhaseHistoryEntry[]) ?? []);
    }
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

    const { error: errHistorial } = await supabase.from("phase_history").insert({
      account_id: accountId,
      user_id: userId,
      phase: cuenta.phase,
      target_percent: targetPercent,
      pnl_alcanzado: pnlAlcanzado,
    });
    if (errHistorial) {
      console.error("avanzarFase: no se pudo guardar el historial de fase", errHistorial.message);
      // No abortamos: el avance de fase es más crítico que el historial
    }

    // No reseteamos phase_target_percent a null: lo dejamos como estaba
    // para que la barra de progreso de la nueva fase siga funcionando
    // con el mismo objetivo como punto de partida. El usuario puede
    // editarlo desde la tarjeta de cuenta si la nueva fase tiene un
    // porcentaje diferente.
    const { error: errAvance } = await supabase
      .from("accounts")
      .update({
        phase: nuevaFase,
        phase_started_at: new Date().toISOString(),
      })
      .eq("id", accountId);
    if (errAvance) {
      console.error("avanzarFase: no se pudo actualizar la fase de la cuenta", errAvance.message);
      return; // Si falla el avance real, no recargamos para no mostrar estado incorrecto
    }

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
    const { data, error } = await supabase
      .from("withdrawals")
      .select("*")
      .order("withdrawal_date", { ascending: false });
    if (!error) {
      setRetiros((data as Withdrawal[]) ?? []);
    }
    setCargandoRetiros(false);
  }

  async function cargarAportes() {
    setCargandoAportes(true);
    const { data, error } = await supabase
      .from("investments")
      .select("*")
      .order("investment_date", { ascending: false });
    if (!error) {
      setAportes((data as Investment[]) ?? []);
    }
    setCargandoAportes(false);
  }

  async function cargarLogros() {
    setCargandoLogros(true);
    const { data, error } = await supabase
      .from("achievements")
      .select("*")
      .order("achieved_date", { ascending: false });
    if (!error) {
      setLogros((data as Achievement[]) ?? []);
    }
    setCargandoLogros(false);
  }

  useEffect(() => {
    cargarCuentas();
    cargarTrades();
    cargarEstrategiasDashboard();
    cargarRetiros();
    cargarAportes();
    cargarLogros();
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
    await Promise.all([cargarCuentas(), cargarTrades(), cargarRetiros(), cargarAportes(), cargarLogros()]);
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
          (item) => hayCuentaReal || (item.id !== "roi" && item.id !== "retiros" && item.id !== "logros" && item.id !== "aportes")
        ),
      })).filter((grupo) => grupo.items.length > 0),
    [hayCuentaReal]
  );

  // Si la única cuenta real se elimina/archiva mientras estás viendo Retiros
  // o ROI, te manda de vuelta al Dashboard para no dejarte en una vista vacía.
  useEffect(() => {
    if (!hayCuentaReal && (vista === "roi" || vista === "retiros" || vista === "logros" || vista === "aportes")) {
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

  /** Suma de aportes reales (fees de challenge, reintentos…) por cuenta.
   *  Reemplaza a purchase_cost en los cálculos de ROI. Si una cuenta no
   *  tiene ningún aporte registrado, volvemos a purchase_cost como
   *  aproximación para no romper cuentas viejas. */
  const invertidoPorCuenta = useMemo(() => {
    const mapa = new Map<string, number>();
    aportes.forEach((a) => {
      if (a.account_id) {
        mapa.set(a.account_id, (mapa.get(a.account_id) ?? 0) + a.amount);
      }
    });
    return mapa;
  }, [aportes]);

  // P&L por cuenta, para mostrar un mini-resumen en cada chip del selector
  const pnlPorCuenta = useMemo(() => {
    const mapa = new Map<string, number>();
    const idsActivas = new Set(cuentas.map((c) => c.id));
    trades
      .filter((t) => t.status === "closed" && t.realized_pnl !== null && t.account_id && idsActivas.has(t.account_id))
      .forEach((t) => {
        const previo = mapa.get(t.account_id as string) ?? 0;
        mapa.set(t.account_id as string, previo + (t.realized_pnl ?? 0));
      });
    return mapa;
  }, [trades, cuentas]);

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
    // Usamos exit_time para el P&L del día (las prop firms calculan la
    // pérdida diaria cuando el trade cierra, no cuando abre).
    const pnlHoy = cerrados
      .filter((t) => fechaKeyLocal(t.exit_time ?? t.entry_time) === hoy)
      .reduce((acc, t) => acc + (t.realized_pnl ?? 0), 0);

    // Racha actual: cuenta trades consecutivos (del más reciente hacia
    // atrás) con el mismo signo de resultado. Breakeven (P&L = 0) no
    // suma ni corta la racha — se ignora completamente.
    let racha = 0;
    let tipoRacha: "ganadora" | "perdedora" | null = null;
    for (let i = cerrados.length - 1; i >= 0; i--) {
      const pnl = cerrados[i].realized_pnl ?? 0;
      if (pnl === 0) continue; // breakeven no afecta la racha
      const esGanadora = pnl > 0;
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
      totalTrades: cerrados.length,
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
            retiradoPorCuenta={retiradoPorCuenta}
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
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${
                            activo ? "bg-kb-gain text-kb-bg" : "bg-kb-surface text-kb-text-secondary"
                          }`}
                        >
                          <IconoNav id={item.id} />
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
                  {nombreParaMostrar}
                </p>
                <p className="truncate text-[10px] text-kb-text-muted">{session.user.email}</p>
              </div>
            </div>
            <button
              onClick={alternarTema}
              className="mb-2 flex w-full items-center justify-between rounded-lg border border-kb-border px-3 py-2 text-xs font-medium text-kb-text-secondary hover:border-kb-accent hover:text-kb-accent transition-colors"
            >
              <span className="flex items-center gap-2">
                {tema === "oscuro" ? "🌙" : "☀️"} Tema {tema === "oscuro" ? "oscuro" : "claro"}
              </span>
              <span className={`relative h-4 w-8 rounded-full transition-colors ${tema === "claro" ? "bg-kb-gain" : "bg-kb-border"}`}>
                <span
                  className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${
                    tema === "claro" ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </span>
            </button>
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
                  <span className="mb-0.5 flex justify-center"><IconoNav id={item.id} className="h-5 w-5" /></span>
                  {item.etiqueta}
                </button>
              ))}
              <button
                onClick={alternarTema}
                className="col-span-3 mb-2 flex items-center justify-center gap-2 rounded-lg border border-kb-border px-3 py-2 text-xs font-medium text-kb-text-secondary"
              >
                {tema === "oscuro" ? "🌙 Tema oscuro" : "☀️ Tema claro"}
              </button>
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
                    const pnlChip = (pnlPorCuenta.get(c.id) ?? 0) - (retiradoPorCuenta.get(c.id) ?? 0);
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
                trades={tradesDeLaCuenta}
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
                estrategias={estrategias}
                modoTodas={modoTodas}
                nombreUsuario={nombreParaMostrar}
                totalRetirado={totalRetirado}
                retiros={retirosDeLaCuenta}
                diaParaRegistrar={diaParaRegistrar}
                onSeleccionarDiaParaRegistrar={setDiaParaRegistrar}
                onIrARegistrar={() => irA("historial")}
                onIrACalendario={() => irA("calendario")}
                onIrARetiros={() => irA("retiros")}
                onIrARoi={() => irA("roi")}
                onIrAEstrategias={() => irA("estrategias")}
                onNuevaCuenta={() => setMostrarModalCuenta(true)}
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
                onIrACalendario={() => setVista("calendario")}
              />
            )}

            {vista === "calendario" && (
              <CalendarioRendimiento
                trades={tradesDeLaCuenta}
                diaSeleccionado={diaParaRegistrar}
                onSeleccionarDia={setDiaParaRegistrar}
                onAbrirDia={manejarAbrirDia}
                soloLectura={modoTodas}
              />
            )}

            {vista === "reportes" && <ReportesView trades={tradesDeLaCuenta} estrategias={estrategias} />}

            {vista === "estrategias" && (
              <EstrategiasView trades={tradesDeLaCuenta} estrategias={estrategias} onCambio={async () => { await cargarEstrategiasDashboard(); await cargarTrades(); }} />
            )}

            {vista === "roi" && (
              <RoiCuentasView cuentas={cuentas} trades={trades} pnlPorCuenta={pnlPorCuenta} retiradoPorCuenta={retiradoPorCuenta} invertidoPorCuenta={invertidoPorCuenta} retiros={retiros} aportes={aportes} />
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

            {vista === "aportes" && (
              <InversionesView
                cuentas={cuentas}
                cuentaActivaId={cuentaActivaId}
                aportes={aportes}
                cargando={cargandoAportes}
                onCambio={cargarAportes}
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
                cuentaActivaId={cuentaActivaId}
                onImportado={cargarTrades}
              />
            )}

            {vista === "perfil" && (
              <PerfilView session={session} onNombreActualizado={setNombrePerfil} />
            )}

            {vista === "configuracion" && (
              <ConfiguracionView
                cuentas={cuentas}
                trades={trades}
                pnlPorCuenta={pnlPorCuenta}
                retiradoPorCuenta={retiradoPorCuenta}
                invertidoPorCuenta={invertidoPorCuenta}
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
  estrategias,
  modoTodas,
  nombreUsuario,
  totalRetirado,
  retiros,
  diaParaRegistrar,
  onSeleccionarDiaParaRegistrar,
  onIrARegistrar,
  onIrACalendario,
  onIrARetiros,
  onIrARoi,
  onIrAEstrategias,
  onNuevaCuenta,
  onAbrirDia,
  onAvanzarFase,
}: {
  cuenta: Account | null;
  trades: Trade[];
  metricas: Metricas;
  cuentas: Account[];
  estrategias: Strategy[];
  modoTodas: boolean;
  nombreUsuario: string;
  totalRetirado: number;
  retiros: Withdrawal[];
  diaParaRegistrar: string;
  onSeleccionarDiaParaRegistrar: (clave: string) => void;
  onIrARegistrar: () => void;
  onIrACalendario: () => void;
  onIrARetiros: () => void;
  onIrARoi: () => void;
  onIrAEstrategias: () => void;
  onNuevaCuenta: () => void;
  onAbrirDia: (clave: string, tradesDelDia: Trade[]) => void;
  onAvanzarFase: (
    accountId: string,
    nuevaFase: AccountPhase,
    pnlAlcanzado: number,
    targetPercent: number | null
  ) => void;
}) {
  const balanceActual = cuenta ? cuenta.starting_balance + metricas.totalPnL - totalRetirado : 0;
  const balanceAnimado = useNumeroAnimado(balanceActual);
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
        (t) => t.status === "closed" && t.realized_pnl !== null && new Date(t.exit_time ?? t.entry_time).getTime() >= inicioFase
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
  const [confirmandoAvanzarFase, setConfirmandoAvanzarFase] = useState<"fase_2" | "financiada" | null>(null);

  // Resetear confirmación de fase si el usuario cambia de cuenta
  // (evita que un "Sí, confirmar" aplique a la cuenta equivocada)
  useEffect(() => {
    setConfirmandoAvanzarFase(null);
  }, [cuenta?.id]);

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
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-kb-accent">Sesión activa</p>
          <h1 className="font-display text-xl font-bold text-kb-text">Hola, {nombreUsuario}</h1>
          <p className="text-xs text-kb-text-secondary">Resumen de tu rendimiento</p>
        </div>
        {metricas.racha > 0 && (
          <div className={`shrink-0 rounded-xl border px-3 py-2 text-center ${
            metricas.tipoRacha === "ganadora"
              ? "border-kb-gain/30 bg-kb-gain/8"
              : "border-kb-loss/30 bg-kb-loss/8"
          }`}>
            <p className="text-[10px] uppercase tracking-wider text-kb-text-muted">Racha</p>
            <p className={`font-mono text-xl font-bold leading-tight ${
              metricas.tipoRacha === "ganadora" ? "text-kb-gain" : "text-kb-loss"
            }`}>
              {metricas.tipoRacha === "ganadora" ? "🔥" : "❄️"} {metricas.racha}
            </p>
            <p className="text-[10px] text-kb-text-muted">
              {metricas.tipoRacha === "ganadora" ? "ganadoras" : "perdedoras"}
            </p>
          </div>
        )}
      </div>

      {/* ---------- Banner de resumen del día ---------- */}
      {(() => {
        const hoy = todayKey();
        const tradesHoy = trades.filter((t) => {
          if (!t.exit_time) return false; // Solo trades cerrados
          return fechaKeyLocal(t.exit_time) === hoy;
        });
        if (tradesHoy.length === 0) return null;
        const pnlHoy = tradesHoy.reduce((sum, t) => sum + (t.realized_pnl ?? 0), 0);
        const ganadoresHoy = tradesHoy.filter((t) => (t.realized_pnl ?? 0) > 0).length;
        return (
          <div className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border px-4 py-3 ${
            pnlHoy >= 0 ? "border-kb-gain/25 bg-kb-gain/5" : "border-kb-loss/25 bg-kb-loss/5"
          }`}>
            <span className="text-lg">{pnlHoy >= 0 ? "📈" : "📉"}</span>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-kb-text-muted">Hoy</span>
            <span className="text-sm text-kb-text-secondary">
              <span className="font-semibold text-kb-text">{tradesHoy.length}</span>{" "}
              op{tradesHoy.length === 1 ? "" : "s"}.
            </span>
            <span className={`font-mono text-sm font-bold ${pnlHoy >= 0 ? "text-kb-gain" : "text-kb-loss"}`}>
              {pnlHoy >= 0 ? "+" : ""}{formatCurrency(pnlHoy)}
            </span>
            <span className="text-sm text-kb-text-secondary">
              <span className="font-semibold text-kb-text">{ganadoresHoy}/{tradesHoy.length}</span> ganadoras
            </span>
          </div>
        );
      })()}

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
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    cuenta.phase === "financiada"
                      ? "bg-kb-gain/15 text-kb-gain"
                      : "bg-kb-accent/10 text-kb-accent"
                  }`}>
                    {cuenta.phase === "financiada" ? "✓ FONDEADA" : PHASE_LABELS[cuenta.phase]}
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
                <p className="mt-0.5 font-mono text-lg font-semibold leading-tight">{formatCurrency(balanceAnimado)}</p>
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
                          confirmandoAvanzarFase === "financiada" ? (
                            <span className="inline-flex items-center gap-2 text-xs">
                              <span className="text-kb-text-secondary">¿Confirmar avance a Financiada?</span>
                              <button
                                onClick={() => { setConfirmandoAvanzarFase(null); onAvanzarFase(cuenta.id, "financiada", pnlDesdeInicioFase, cuenta.phase_target_percent); }}
                                className="rounded-lg bg-kb-gain px-2.5 py-1 font-semibold text-kb-bg hover:brightness-110 transition"
                              >
                                Sí, confirmar
                              </button>
                              <button
                                onClick={() => setConfirmandoAvanzarFase(null)}
                                className="rounded-lg border border-kb-border px-2.5 py-1 text-kb-text-secondary hover:text-kb-text transition"
                              >
                                Cancelar
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => setConfirmandoAvanzarFase("financiada")}
                              className="rounded-lg bg-kb-gain px-3 py-1.5 text-xs font-semibold text-kb-bg hover:brightness-110 transition"
                            >
                              Marcar como Financiada
                            </button>
                          )
                        ) : (
                          confirmandoAvanzarFase === "fase_2" ? (
                            <span className="inline-flex items-center gap-2 text-xs">
                              <span className="text-kb-text-secondary">¿Confirmar avance a Fase 2?</span>
                              <button
                                onClick={() => { setConfirmandoAvanzarFase(null); onAvanzarFase(cuenta.id, "fase_2", pnlDesdeInicioFase, cuenta.phase_target_percent); }}
                                className="rounded-lg bg-kb-accent px-2.5 py-1 font-semibold text-kb-bg hover:brightness-110 transition"
                              >
                                Sí, confirmar
                              </button>
                              <button
                                onClick={() => setConfirmandoAvanzarFase(null)}
                                className="rounded-lg border border-kb-border px-2.5 py-1 text-kb-text-secondary hover:text-kb-text transition"
                              >
                                Cancelar
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => setConfirmandoAvanzarFase("fase_2")}
                              className="rounded-lg bg-kb-accent px-3 py-1.5 text-xs font-semibold text-kb-bg hover:brightness-110 transition"
                            >
                              Pasar a Fase 2
                            </button>
                          )
                        ))}
                      {cuenta.phase === "fase_2" && (
                        confirmandoAvanzarFase === "financiada" ? (
                          <span className="inline-flex items-center gap-2 text-xs">
                            <span className="text-kb-text-secondary">¿Confirmar avance a Financiada?</span>
                            <button
                              onClick={() => { setConfirmandoAvanzarFase(null); onAvanzarFase(cuenta.id, "financiada", pnlDesdeInicioFase, cuenta.phase_target_percent); }}
                              className="rounded-lg bg-kb-gain px-2.5 py-1 font-semibold text-kb-bg hover:brightness-110 transition"
                            >
                              Sí, confirmar
                            </button>
                            <button
                              onClick={() => setConfirmandoAvanzarFase(null)}
                              className="rounded-lg border border-kb-border px-2.5 py-1 text-kb-text-secondary hover:text-kb-text transition"
                            >
                              Cancelar
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setConfirmandoAvanzarFase("financiada")}
                            className="rounded-lg bg-kb-gain px-3 py-1.5 text-xs font-semibold text-kb-bg hover:brightness-110 transition"
                          >
                            Marcar como Financiada
                          </button>
                        )
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

      {/* Checklist de primeros pasos — se muestra a usuarios sin cuenta o
          sin operaciones cargadas. La condición antes era solo
          cuentas.length === 0, lo que dejaba el dashboard vacío (todo en
          $0,00) cuando existía una cuenta pero sin trades. */}
      {(cuentas.length === 0 || trades.length === 0) && (() => {
        const pasoCuentaListo = cuentas.length > 0;
        const pasoTradeListo = trades.length > 0;
        const pasoEstrategiaListo = estrategias.length > 0;
        const pasosListos = [pasoCuentaListo, pasoTradeListo, pasoEstrategiaListo].filter(Boolean).length;
        const totalPasos = 3;

        // Próximo paso pendiente (para el CTA principal)
        const proximoPasoPendiente = !pasoCuentaListo ? 1 : !pasoTradeListo ? 2 : !pasoEstrategiaListo ? 3 : null;

        return (
          <section className="rounded-xl border border-kb-accent/25 bg-gradient-to-br from-kb-accent/8 to-kb-accent/3 p-5">
            {/* Encabezado */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl">
                    {pasosListos === 0 ? "👋" : pasosListos === totalPasos ? "🎉" : "⚡"}
                  </span>
                  <h2 className="font-display text-base font-semibold text-kb-text">
                    {pasosListos === 0
                      ? "¡Bienvenido a KeboTrader!"
                      : pasosListos === totalPasos
                      ? "¡Todo listo!"
                      : "Primeros pasos"}
                  </h2>
                </div>
                <p className="mt-0.5 text-xs text-kb-text-secondary">
                  {pasosListos === 0
                    ? "Completá estos pasos para tener tu diario operativo."
                    : pasosListos === totalPasos
                    ? "Tu diario está completamente configurado."
                    : `${pasosListos} de ${totalPasos} completados — ¡seguí así!`}
                </p>
              </div>
              {/* Progreso circular-ish como badge */}
              <div className="shrink-0 text-right">
                <span className="font-mono text-2xl font-bold text-kb-accent leading-none">
                  {pasosListos}
                </span>
                <span className="font-mono text-sm text-kb-text-muted">/{totalPasos}</span>
              </div>
            </div>

            {/* Barra de progreso */}
            <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-kb-border">
              <div
                className="h-full rounded-full bg-kb-accent transition-all duration-500"
                style={{ width: `${(pasosListos / totalPasos) * 100}%` }}
              />
            </div>

            {/* Pasos */}
            <div className="mt-4 space-y-2">
              {/* Paso 1: Crear cuenta */}
              <div className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                pasoCuentaListo
                  ? "border-kb-gain/20 bg-kb-gain/5"
                  : "border-kb-border-soft bg-kb-surface"
              }`}>
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  pasoCuentaListo ? "bg-kb-gain text-kb-bg" : "bg-kb-accent text-kb-bg"
                }`}>
                  {pasoCuentaListo ? "✓" : "1"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium leading-tight ${
                    pasoCuentaListo ? "text-kb-text-muted line-through" : "text-kb-text"
                  }`}>
                    Crear una cuenta
                  </p>
                  {!pasoCuentaListo && (
                    <p className="text-[11px] text-kb-text-secondary mt-0.5">
                      Real, demo o challenge — la que uses.
                    </p>
                  )}
                </div>
                {!pasoCuentaListo && (
                  <button
                    onClick={onNuevaCuenta}
                    className="shrink-0 rounded-lg bg-kb-accent px-3 py-1.5 text-xs font-semibold text-kb-bg hover:brightness-110 transition"
                  >
                    Crear →
                  </button>
                )}
              </div>

              {/* Paso 2: Primera operación */}
              <div className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                pasoTradeListo
                  ? "border-kb-gain/20 bg-kb-gain/5"
                  : pasoCuentaListo
                  ? "border-kb-border-soft bg-kb-surface"
                  : "border-kb-border-soft bg-kb-surface opacity-50"
              }`}>
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  pasoTradeListo
                    ? "bg-kb-gain text-kb-bg"
                    : pasoCuentaListo
                    ? "bg-kb-accent text-kb-bg"
                    : "bg-kb-border text-kb-text-muted"
                }`}>
                  {pasoTradeListo ? "✓" : "2"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium leading-tight ${
                    pasoTradeListo ? "text-kb-text-muted line-through" : "text-kb-text"
                  }`}>
                    Registrar primera operación
                  </p>
                  {!pasoTradeListo && pasoCuentaListo && (
                    <p className="text-[11px] text-kb-text-secondary mt-0.5">
                      Hacé clic en un día del Calendario para cargarla.
                    </p>
                  )}
                </div>
                {!pasoTradeListo && pasoCuentaListo && (
                  <button
                    onClick={onIrACalendario}
                    className="shrink-0 rounded-lg bg-kb-accent px-3 py-1.5 text-xs font-semibold text-kb-bg hover:brightness-110 transition"
                  >
                    Ir →
                  </button>
                )}
              </div>

              {/* Paso 3: Estrategia */}
              <div className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                pasoEstrategiaListo
                  ? "border-kb-gain/20 bg-kb-gain/5"
                  : pasoTradeListo
                  ? "border-kb-border-soft bg-kb-surface"
                  : "border-kb-border-soft bg-kb-surface opacity-50"
              }`}>
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  pasoEstrategiaListo
                    ? "bg-kb-gain text-kb-bg"
                    : pasoTradeListo
                    ? "bg-kb-accent text-kb-bg"
                    : "bg-kb-border text-kb-text-muted"
                }`}>
                  {pasoEstrategiaListo ? "✓" : "3"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium leading-tight ${
                    pasoEstrategiaListo ? "text-kb-text-muted line-through" : "text-kb-text"
                  }`}>
                    Definir tu estrategia
                  </p>
                  {!pasoEstrategiaListo && pasoTradeListo && (
                    <p className="text-[11px] text-kb-text-secondary mt-0.5">
                      Documentá tu plan de trading para seguirlo con disciplina.
                    </p>
                  )}
                  {!pasoTradeListo && !pasoEstrategiaListo && (
                    <p className="text-[11px] text-kb-text-secondary mt-0.5">
                      Disponible después del paso 2.
                    </p>
                  )}
                </div>
                {!pasoEstrategiaListo && pasoTradeListo && (
                  <button
                    onClick={onIrAEstrategias}
                    className="shrink-0 rounded-lg bg-kb-accent px-3 py-1.5 text-xs font-semibold text-kb-bg hover:brightness-110 transition"
                  >
                    Crear →
                  </button>
                )}
              </div>
            </div>

            {/* Mensaje final si ya completó todo */}
            {proximoPasoPendiente === null && (
              <p className="mt-3 text-center text-xs text-kb-text-secondary">
                🚀 Tu diario está listo. Seguí registrando operaciones para ver tus métricas.
              </p>
            )}
          </section>
        );
      })()}

      {/* ---------- Consejo del día ---------- */}
      <ConsejoDelDiaWidget />

      {/* ---------- Puntaje KeboTrader + comparación mensual ---------- */}
      <section className="grid gap-4 sm:grid-cols-2">
        <KeboScoreWidget trades={trades} />
        <ComparacionMensualWidget trades={trades} />
      </section>

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
        />

        <section className="rounded-xl border border-kb-border bg-kb-surface">
          <div className="flex items-center justify-between border-b border-kb-border-soft px-4 py-2.5">
            <h2 className="font-display text-sm font-semibold">Trades recientes</h2>
            <button onClick={onIrARegistrar} className="text-xs font-medium text-kb-accent hover:underline">
              Ver todos →
            </button>
          </div>

          {ultimasOperaciones.length === 0 ? (
            <div className="flex flex-col items-center gap-2.5 px-4 py-8 text-center">
              <span className="text-2xl">📋</span>
              <p className="text-sm text-kb-text-secondary">
                {cuentas.length === 0
                  ? "Primero creá una cuenta para empezar a registrar."
                  : "Todavía no registraste operaciones. ¡Cargá tu primera trade!"}
              </p>
              {cuentas.length > 0 && (
                <button
                  onClick={onIrACalendario}
                  className="rounded-lg bg-kb-accent/10 px-4 py-1.5 text-xs font-semibold text-kb-accent hover:bg-kb-accent/20 transition-colors"
                >
                  Ir al Calendario →
                </button>
              )}
            </div>
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
  trades,
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
  trades: Trade[];
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
          tradesRecientes={trades}
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
}: {
  trades: Trade[];
  diaSeleccionado: string;
  onSeleccionarDia: (clave: string) => void;
  onVerCompleto: () => void;
  onAbrirDia: (clave: string, tradesDelDia: Trade[]) => void;
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
  onIrACalendario,
}: {
  trades: Trade[];
  estrategias: Strategy[];
  cargando: boolean;
  error: string | null;
  onTradeCreado: () => void;
  onIrACalendario?: () => void;
}) {
  const [filtros, setFiltros] = useState<Filtros>({ estrategiaId: "", sesion: "", resultado: "" });
  const [busqueda, setBusqueda] = useState("");
  const [tradeSeleccionado, setTradeSeleccionado] = useState<Trade | null>(null);
  const [hashtagActivo, setHashtagActivo] = useState<string | null>(null);

  // Extrae todos los #hashtags únicos de las notas de todos los trades
  const hashtags = useMemo(() => {
    const set = new Set<string>();
    trades.forEach((t) => {
      if (t.notes) {
        const matches = t.notes.match(/#\w+/g) ?? [];
        matches.forEach((m) => set.add(m.toLowerCase()));
      }
    });
    return Array.from(set).sort();
  }, [trades]);

  const tradesFiltrados = useMemo(() => {
    const busquedaNormalizada = busqueda.trim().toUpperCase();
    return trades.filter((t) => {
      if (filtros.estrategiaId && t.strategy_id !== filtros.estrategiaId) return false;
      if (filtros.sesion && t.session !== filtros.sesion) return false;
      if (filtros.resultado && t.result_type !== filtros.resultado) return false;
      if (busquedaNormalizada && !t.symbol.toUpperCase().includes(busquedaNormalizada)) return false;
      if (hashtagActivo && !t.notes?.toLowerCase().includes(hashtagActivo)) return false;
      return true;
    });
  }, [trades, filtros, busqueda, hashtagActivo]);

  const hayFiltrosActivos =
    filtros.estrategiaId !== "" || filtros.sesion !== "" || filtros.resultado !== "" || busqueda !== "" || hashtagActivo !== null;

  return (
    <div className="space-y-6">
      <section className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-kb-border bg-kb-surface px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 text-base">📅</span>
          <p className="text-sm text-kb-text-secondary">
            Para registrar una nueva operación, hacé clic en el día desde el{" "}
            <span className="font-medium text-kb-accent">Calendario</span>. Acá solo vas a ver tu historial.
          </p>
        </div>
        {onIrACalendario && (
          <button
            onClick={onIrACalendario}
            className="shrink-0 rounded-lg border border-kb-accent/40 px-3 py-1.5 text-xs font-medium text-kb-accent hover:bg-kb-accent/10 transition-colors"
          >
            Ir al Calendario
          </button>
        )}
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
                  setHashtagActivo(null);
                }}
                className="rounded-lg border border-kb-border px-2.5 py-1.5 text-xs text-kb-text-secondary hover:text-kb-text transition-colors"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        </div>

        {/* Chips de hashtags — solo se muestran si hay al menos uno en las notas */}
        {hashtags.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-kb-border-soft px-5 py-3">
            <span className="text-[10px] uppercase tracking-wider text-kb-text-muted">Tags:</span>
            {hashtags.map((tag) => (
              <button
                key={tag}
                onClick={() => setHashtagActivo(hashtagActivo === tag ? null : tag)}
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${
                  hashtagActivo === tag
                    ? "bg-kb-accent text-kb-bg"
                    : "border border-kb-border bg-kb-bg text-kb-text-secondary hover:border-kb-accent/50 hover:text-kb-accent"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

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
  const [confirmandoEliminarRegla, setConfirmandoEliminarRegla] = useState<number | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  useCerrarConEscape(() => { setConfirmandoEliminar(false); setConfirmandoEliminarRegla(null); });

  async function guardarNombre() {
    const nombreLimpio = nombreEditado.trim();
    if (!nombreLimpio || nombreLimpio === estrategia.name) {
      setEditandoNombre(false);
      setNombreEditado(estrategia.name);
      return;
    }
    const { error } = await supabase.from("strategies").update({ name: nombreLimpio }).eq("id", estrategia.id);
    if (error) {
      setNombreEditado(estrategia.name); // revertir visualmente
      setErrorAccion(`No se pudo guardar el nombre: ${error.message}`);
    } else {
      setErrorAccion(null);
    }
    setEditandoNombre(false);
    onCambio();
  }

  async function agregarRegla(e: FormEvent) {
    e.preventDefault();
    const texto = nuevaRegla.trim();
    if (!texto) return;
    setGuardando(true);
    const { error } = await supabase
      .from("strategies")
      .update({ rules: [...reglas, texto] })
      .eq("id", estrategia.id);
    setGuardando(false);
    if (error) {
      setErrorAccion(`No se pudo agregar la regla: ${error.message}`);
    } else {
      setNuevaRegla("");
      setMostrarFormRegla(false);
      setErrorAccion(null);
    }
    onCambio();
  }

  async function eliminarRegla(indice: number) {
    const nuevasReglas = reglas.filter((_, i) => i !== indice);
    const { error } = await supabase.from("strategies").update({ rules: nuevasReglas }).eq("id", estrategia.id);
    if (error) {
      setErrorAccion(`No se pudo eliminar la regla: ${error.message}`);
    } else {
      setConfirmandoEliminarRegla(null);
      setErrorAccion(null);
    }
    onCambio();
  }

  async function eliminarEstrategia() {
    // No borramos los trades: solo desvinculamos la estrategia de ellos
    // (quedan como "Sin estrategia"), y después borramos la estrategia.
    const { error: errorDesvincular } = await supabase.from("trades").update({ strategy_id: null }).eq("strategy_id", estrategia.id);
    if (errorDesvincular) {
      setErrorAccion(`No se pudo desvincular los trades: ${errorDesvincular.message}`);
      setConfirmandoEliminar(false);
      return;
    }
    const { error: errorEliminar } = await supabase.from("strategies").delete().eq("id", estrategia.id);
    if (errorEliminar) {
      setErrorAccion(`No se pudo eliminar la estrategia: ${errorEliminar.message}`);
      setConfirmandoEliminar(false);
      return;
    }
    onCambio();
  }

  return (
    <section className="overflow-hidden rounded-xl border border-kb-border bg-kb-surface">
      <div className={`h-1 w-full ${color.barra}`} />
      {errorAccion && (
        <p className="mx-5 mt-3 rounded-md bg-kb-loss/10 px-3 py-2 text-xs text-kb-loss">
          {errorAccion}
        </p>
      )}

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
                {confirmandoEliminarRegla === i ? (
                  <span className="inline-flex items-center gap-1 text-xs">
                    <button
                      onClick={() => { setConfirmandoEliminarRegla(null); eliminarRegla(i); }}
                      className="font-semibold text-kb-loss hover:brightness-110 transition-colors"
                    >
                      Sí
                    </button>
                    <span className="text-kb-text-muted">·</span>
                    <button
                      onClick={() => setConfirmandoEliminarRegla(null)}
                      className="text-kb-text-muted hover:text-kb-text transition-colors"
                    >
                      No
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmandoEliminarRegla(i)}
                    className="text-xs text-kb-text-muted opacity-0 hover:text-kb-loss group-hover:opacity-100 transition-opacity"
                  >
                    ✕
                  </button>
                )}
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
    const pnl = t.realized_pnl ?? 0;
    if (pnl === 0) return; // breakeven no corta ni suma racha
    const tipo = pnl > 0 ? "g" : "p";
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
    // Si el pico nunca superó cero (todas las ops son pérdidas desde el
    // inicio), no podemos expresar la caída como % de un pico positivo —
    // devolvemos null para que la UI muestre "—" en vez de "0.0%".
    const porcentaje = pico > 0 ? peorCaidaPorcentaje : peorCaidaMonto > 0 ? null : 0;
    return { monto: peorCaidaMonto, porcentaje };
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
  // Cuenta desde el campo nuevo "mistakes" (varios por trade). Para
  // trades viejos que solo tienen el campo singular "mistake", lo usa
  // como respaldo — así no se pierden estadísticas de antes de este
  // cambio.
  const porError = useMemo(() => {
    const grupos = new Map<MistakeType, { pnl: number; total: number }>();
    cerrados.forEach((t) => {
      const listaErrores =
        t.mistakes && t.mistakes.length > 0
          ? t.mistakes
          : t.mistake && t.mistake !== "ninguno"
          ? [t.mistake]
          : [];
      listaErrores.forEach((error) => {
        if (error === "ninguno") return;
        const actual = grupos.get(error) ?? { pnl: 0, total: 0 };
        actual.pnl += t.realized_pnl ?? 0;
        actual.total += 1;
        grupos.set(error, actual);
      });
    });
    return Array.from(grupos.entries())
      .map(([error, d]) => ({ etiqueta: MISTAKE_LABELS[error], ...d }))
      .sort((a, b) => b.total - a.total);
  }, [cerrados]);

  // ---- Distribución de R-múltiplos ----
  // No es lo mismo "gano seguido montos chicos y de vez en cuando pierdo
  // grande" que "gano parejo" — el P&L total no distingue estos dos
  // patrones, pero esta distribución sí. Solo cuenta trades que tienen
  // el riesgo cargado (sin eso no se puede calcular el R).
  const BUCKETS_R = [
    { etiqueta: "< -2R", min: -Infinity, max: -2 },
    { etiqueta: "-2R a -1R", min: -2, max: -1 },
    { etiqueta: "-1R a 0R", min: -1, max: 0 },
    { etiqueta: "0R a 1R", min: 0, max: 1 },
    { etiqueta: "1R a 2R", min: 1, max: 2 },
    { etiqueta: "2R a 3R", min: 2, max: 3 },
    { etiqueta: "> 3R", min: 3, max: Infinity },
  ];
  const distribucionR = useMemo(() => {
    const valoresR = cerrados
      .map((t) => calcularRMultiple(t.realized_pnl, t.risk_amount))
      .filter((r): r is number => r !== null);
    const conteos = BUCKETS_R.map((b) => ({
      ...b,
      cantidad: valoresR.filter((r) => r >= b.min && r < b.max).length,
    }));
    return { conteos, totalConR: valoresR.length, totalSinR: cerrados.length - valoresR.length };
  }, [cerrados]);

  // ---- Rendimiento por hora del día ----
  // "Sesión" (Asia/Londres/NY) son bloques de varias horas — puede que
  // tu ventaja real esté concentrada en una franja mucho más chica
  // dentro de esa sesión. Esto lo muestra hora por hora.
  const porHora = useMemo(() => {
    const grupos = new Map<number, { pnl: number; total: number; ganadores: number }>();
    cerrados.forEach((t) => {
      const hora = new Date(t.entry_time).getHours();
      const actual = grupos.get(hora) ?? { pnl: 0, total: 0, ganadores: 0 };
      actual.pnl += t.realized_pnl ?? 0;
      actual.total += 1;
      if ((t.realized_pnl ?? 0) > 0) actual.ganadores += 1;
      grupos.set(hora, actual);
    });
    return Array.from({ length: 24 }, (_, hora) => {
      const d = grupos.get(hora);
      return {
        hora,
        etiqueta: `${String(hora).padStart(2, "0")}:00`,
        pnl: d?.pnl ?? 0,
        total: d?.total ?? 0,
        winRate: d && d.total > 0 ? (d.ganadores / d.total) * 100 : 0,
      };
    }).filter((h) => h.total > 0);
  }, [cerrados]);

  // ---- Rendimiento por número de operación del día (detector de overtrading) ----
  // Investigando otras journals encontré este patrón: muchos traders que
  // hacen varias operaciones por día rinden peor a partir de la 3ra/4ta.
  // Esto agrupa TODAS tus operaciones según si fueron la 1ra, 2da, 3ra...
  // del día en que las hiciste (sin importar qué día fue), para ver si a
  // vos te pasa lo mismo — y en qué operación del día conviene frenar.
  const porNumeroDeOperacion = useMemo(() => {
    const porDia = new Map<string, Trade[]>();
    cerrados.forEach((t) => {
      const clave = fechaKeyLocal(t.entry_time);
      if (!porDia.has(clave)) porDia.set(clave, []);
      porDia.get(clave)!.push(t);
    });

    const porNumero = new Map<number, { pnl: number; total: number; ganadores: number }>();
    porDia.forEach((tradesDelDia) => {
      const ordenados = [...tradesDelDia].sort(
        (a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime()
      );
      ordenados.forEach((t, i) => {
        const numero = Math.min(i + 1, 6); // de la 6ta operación en adelante, se agrupan juntas
        const actual = porNumero.get(numero) ?? { pnl: 0, total: 0, ganadores: 0 };
        actual.pnl += t.realized_pnl ?? 0;
        actual.total += 1;
        if ((t.realized_pnl ?? 0) > 0) actual.ganadores += 1;
        porNumero.set(numero, actual);
      });
    });

    return Array.from({ length: 6 }, (_, i) => {
      const numero = i + 1;
      const d = porNumero.get(numero);
      return {
        numero,
        etiqueta: numero === 6 ? "6ª +" : `${numero}ª`,
        pnlPromedio: d && d.total > 0 ? d.pnl / d.total : 0,
        total: d?.total ?? 0,
        winRate: d && d.total > 0 ? (d.ganadores / d.total) * 100 : 0,
      };
    }).filter((x) => x.total > 0);
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

  // ---- Rendimiento (PnL + winrate) por día de la semana ----
  const rendimientoPorDiaSemana = useMemo(() => {
    const mapa = new Map<number, { pnl: number; total: number; ganadores: number }>();
    [0, 1, 2, 3, 4, 5, 6].forEach((d) => mapa.set(d, { pnl: 0, total: 0, ganadores: 0 }));
    cerrados.forEach((t) => {
      const dia = new Date(t.entry_time).getDay();
      const entry = mapa.get(dia)!;
      entry.pnl += t.realized_pnl ?? 0;
      entry.total += 1;
      if ((t.realized_pnl ?? 0) > 0) entry.ganadores += 1;
    });
    // Lun=1, Mar=2, … Dom=0 → índice 6
    return [1, 2, 3, 4, 5, 6, 0].map((dayIdx, i) => {
      const d = mapa.get(dayIdx)!;
      return {
        etiqueta: DIAS_SEMANA[i],
        pnl: d.pnl,
        total: d.total,
        winRate: d.total > 0 ? (d.ganadores / d.total) * 100 : 0,
      };
    });
  }, [cerrados]);

  // ---- % adherencia al plan (proxy: trades sin errores registrados) ----
  const adherencia = useMemo(() => {
    if (cerrados.length === 0) return null;
    const sinErrores = cerrados.filter(
      (t) =>
        (!t.mistakes || t.mistakes.length === 0) &&
        (!t.mistake || t.mistake === "ninguno")
    ).length;
    return (sinErrores / cerrados.length) * 100;
  }, [cerrados]);

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
          <h1 className="font-display text-xl font-bold text-kb-text">Estadísticas</h1>
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
      <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
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
        <MetricCard
          etiqueta="Adherencia al plan"
          valor={adherencia !== null ? `${adherencia.toFixed(0)}%` : "—"}
          tono={adherencia !== null ? (adherencia >= 80 ? "gain" : adherencia >= 60 ? undefined : "loss") : undefined}
        />
      </section>

      {/* ---------- Curva de equity del período ---------- */}
      <section className="rounded-xl border border-kb-border bg-kb-surface p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-base font-semibold">Curva de equity</h2>
          <span className="text-xs text-kb-text-muted">
            Caída máxima {formatCurrency(drawdown.monto)}{" "}
            ({drawdown.porcentaje !== null ? `${drawdown.porcentaje.toFixed(1)}%` : "—"})
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

      {/* ---------- Heatmap de rendimiento por día de la semana ---------- */}
      <section className="rounded-xl border border-kb-border bg-kb-surface p-5">
        <h2 className="font-display text-lg font-semibold">¿En qué día de la semana rendís mejor?</h2>
        <p className="mb-5 text-xs text-kb-text-secondary">
          PnL acumulado por día — el color indica ganancia (verde) o pérdida (rojo), la intensidad refleja la magnitud.
        </p>
        {(() => {
          const maxAbs = Math.max(...rendimientoPorDiaSemana.map((d) => Math.abs(d.pnl)), 1);
          return (
            <div className="grid grid-cols-7 gap-2">
              {rendimientoPorDiaSemana.map((d) => {
                const intensidad = Math.abs(d.pnl) / maxAbs;
                const esGanancia = d.pnl >= 0;
                return (
                  <div key={d.etiqueta} className="flex flex-col items-center gap-1.5">
                    <div
                      className="relative flex w-full flex-col items-center justify-center overflow-hidden rounded-xl border border-kb-border-soft"
                      style={{ minHeight: 80 }}
                      title={`${d.etiqueta}: ${d.total > 0 ? formatCurrency(d.pnl) : "Sin datos"} · ${d.total > 0 ? `${d.winRate.toFixed(0)}% WR · ${d.total} ops` : ""}`}
                    >
                      {/* Capa de color con opacidad proporcional */}
                      {d.total > 0 && (
                        <div
                          className={`absolute inset-0 ${esGanancia ? "bg-kb-gain" : "bg-kb-loss"}`}
                          style={{ opacity: 0.1 + intensidad * 0.55 }}
                        />
                      )}
                      <div className="relative flex flex-col items-center gap-0.5 py-3 px-1">
                        {d.total > 0 ? (
                          <>
                            <span className={`font-mono text-[11px] font-bold ${esGanancia ? "text-kb-gain" : "text-kb-loss"}`}>
                              {esGanancia ? "+" : ""}{formatCurrency(d.pnl)}
                            </span>
                            <span className="text-[10px] text-kb-text-muted">{d.winRate.toFixed(0)}% WR</span>
                            <span className="text-[10px] text-kb-text-muted">{d.total} ops</span>
                          </>
                        ) : (
                          <span className="text-[10px] text-kb-text-muted">—</span>
                        )}
                      </div>
                    </div>
                    <span className="text-[11px] font-medium text-kb-text-secondary">{d.etiqueta}</span>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </section>

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

      {/* ---------- Distribución de R-múltiplos ---------- */}
      <section className="rounded-xl border border-kb-border bg-kb-surface p-5">
        <h2 className="font-display text-lg font-semibold">Distribución de R-múltiplos</h2>
        <p className="mb-4 text-xs text-kb-text-secondary">
          ¿Ganás parejo, o ganás poquito seguido y de vez en cuando perdés grande? Solo cuenta
          trades con el riesgo cargado ({distribucionR.totalConR} de {distribucionR.totalConR + distribucionR.totalSinR}).
        </p>
        {distribucionR.totalConR === 0 ? (
          <p className="py-6 text-center text-sm text-kb-text-secondary">
            Cargá el campo &quot;Monto arriesgado&quot; en tus trades para desbloquear esto.
          </p>
        ) : (
          <div className="flex h-40 items-end gap-2">
            {distribucionR.conteos.map((b) => {
              const max = Math.max(...distribucionR.conteos.map((x) => x.cantidad), 1);
              const esNegativo = b.max <= 0;
              return (
                <div key={b.etiqueta} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[10px] text-kb-text-muted">{b.cantidad || ""}</span>
                  <div
                    className={`w-full rounded-t-sm ${esNegativo ? "bg-kb-loss/70" : "bg-kb-gain/70"}`}
                    style={{ height: `${Math.max((b.cantidad / max) * 100, b.cantidad > 0 ? 6 : 0)}%` }}
                  />
                  <span className="text-[9px] text-kb-text-muted">{b.etiqueta}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ---------- Rendimiento por hora del día ---------- */}
      <section className="rounded-xl border border-kb-border bg-kb-surface p-5">
        <h2 className="font-display text-lg font-semibold">Rendimiento por hora del día</h2>
        <p className="mb-4 text-xs text-kb-text-secondary">
          Más preciso que por sesión — capaz tu ventaja real está en una franja de 1 hora, no en las 9 horas de "Londres".
        </p>
        {porHora.length === 0 ? (
          <p className="py-6 text-center text-sm text-kb-text-secondary">Sin datos suficientes todavía.</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="flex h-32 min-w-[600px] items-end gap-1.5">
              {porHora.map((h) => {
                const max = Math.max(...porHora.map((x) => Math.abs(x.pnl)), 1);
                return (
                  <div key={h.hora} className="flex flex-1 flex-col items-center gap-1" title={`${h.etiqueta} · ${formatCurrency(h.pnl)} · ${h.total} ops`}>
                    <div
                      className={`w-full rounded-t-sm ${h.pnl >= 0 ? "bg-kb-gain/70" : "bg-kb-loss/70"}`}
                      style={{ height: `${Math.max((Math.abs(h.pnl) / max) * 100, 6)}%` }}
                    />
                    <span className="text-[9px] text-kb-text-muted">{h.hora}h</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* ---------- Rendimiento por número de operación del día ---------- */}
      <section className="rounded-xl border border-kb-border bg-kb-surface p-5">
        <h2 className="font-display text-lg font-semibold">¿Te conviene parar en algún momento?</h2>
        <p className="mb-4 text-xs text-kb-text-secondary">
          Agrupa tus operaciones según si fueron la 1ª, 2ª, 3ª... del día (sin importar qué día
          fue). Muchos traders rinden peor a partir de cierto número de operación — este gráfico
          te dice si a vos también te pasa, y en qué operación conviene frenar.
        </p>
        {porNumeroDeOperacion.length === 0 ? (
          <p className="py-6 text-center text-sm text-kb-text-secondary">Sin datos suficientes todavía.</p>
        ) : (
          <>
            <div className="flex h-36 items-end gap-3">
              {porNumeroDeOperacion.map((n) => {
                const max = Math.max(...porNumeroDeOperacion.map((x) => Math.abs(x.pnlPromedio)), 1);
                return (
                  <div key={n.numero} className="flex flex-1 flex-col items-center gap-1.5">
                    <span className="text-[10px] font-mono text-kb-text-muted">{formatCurrency(n.pnlPromedio)}</span>
                    <div
                      className={`w-full rounded-t-sm ${n.pnlPromedio >= 0 ? "bg-kb-gain/70" : "bg-kb-loss/70"}`}
                      style={{ height: `${Math.max((Math.abs(n.pnlPromedio) / max) * 100, 6)}%` }}
                    />
                    <span className="text-[11px] font-medium text-kb-text-secondary">{n.etiqueta} op. del día</span>
                    <span className="text-[9px] text-kb-text-muted">{n.total} veces</span>
                  </div>
                );
              })}
            </div>
            {(() => {
              const primera = porNumeroDeOperacion[0];
              const peorDespuesDeLaPrimera = porNumeroDeOperacion
                .slice(1)
                .find((n) => n.pnlPromedio < 0 && primera.pnlPromedio >= 0);
              return peorDespuesDeLaPrimera ? (
                <p className="mt-4 rounded-lg border border-kb-loss/30 bg-kb-loss/10 px-3 py-2 text-xs text-kb-loss">
                  ⚠️ Tu {peorDespuesDeLaPrimera.etiqueta.toLowerCase()} operación del día promedia{" "}
                  {formatCurrency(peorDespuesDeLaPrimera.pnlPromedio)} — capaz vale la pena poner un límite
                  de operaciones por día.
                </p>
              ) : null;
            })()}
          </>
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
  trades,
  pnlPorCuenta,
  retiradoPorCuenta,
  invertidoPorCuenta,
  retiros,
  aportes,
}: {
  cuentas: Account[];
  trades: Trade[];
  pnlPorCuenta: Map<string, number>;
  retiradoPorCuenta: Map<string, number>;
  invertidoPorCuenta: Map<string, number>;
  retiros: Withdrawal[];
  aportes: Investment[];
}) {
  const filas = useMemo(() => {
    return cuentas.map((c) => {
      const pnl = pnlPorCuenta.get(c.id) ?? 0;
      const retirado = retiradoPorCuenta.get(c.id) ?? 0;
      const balanceActual = c.starting_balance + pnl - retirado;
      // "Invertido" = suma de aportes reales registrados en la tabla investments.
      // Si no hay aportes cargados, cae en purchase_cost (cargado a mano al crear
      // la cuenta) y si tampoco hay eso, usa el balance inicial como aproximación.
      const aportesReales = invertidoPorCuenta.get(c.id);
      const invertido = aportesReales ?? c.purchase_cost ?? c.starting_balance;
      const tieneAportesReales = aportesReales !== undefined;
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
        costoSinCargar: !tieneAportesReales && c.purchase_cost === null,
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
                        title="No hay aportes registrados para esta cuenta ni purchase_cost — se está usando el balance inicial como aproximación. Cargá los aportes en la sección Aportes."
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

      <ReportesFiscalesSection trades={trades} cuentas={cuentas} retiros={retiros} aportes={aportes} />
    </div>
  );
}

// =====================================================================
// REPORTES FISCALES — resumen anual de ganancias/pérdidas, por cuenta y
// total, para llevarle a un contador. La app da los NÚMEROS; cómo
// declararlos depende de las leyes de cada país, así que no reemplaza
// el asesoramiento de un contador o abogado impositivo.
// =====================================================================

const MESES_CORTOS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

function ReportesFiscalesSection({
  trades,
  cuentas,
  retiros,
  aportes,
}: {
  trades: Trade[];
  cuentas: Account[];
  retiros: Withdrawal[];
  aportes: Investment[];
}) {
  const [abierto, setAbierto] = useState(false);
  const [tab, setTab] = useState<"retiros" | "pnl">("retiros");

  // ── años con datos ─────────────────────────────────────────────────
  const añosDisponibles = useMemo(() => {
    const años = new Set<number>();
    retiros.forEach((r) => años.add(new Date(r.withdrawal_date).getFullYear()));
    trades
      .filter((t) => t.status === "closed" && t.realized_pnl !== null)
      .forEach((t) => años.add(new Date(t.entry_time).getFullYear()));
    return Array.from(años).sort((a, b) => b - a);
  }, [retiros, trades]);

  const [añoElegido, setAñoElegido] = useState<number>(() => new Date().getFullYear());

  // ── Tab "Retiros": tabla mes a mes ────────────────────────────────
  const filasRetirosMes = useMemo(() => {
    const retirosAño = retiros.filter(
      (r) => new Date(r.withdrawal_date).getFullYear() === añoElegido
    );
    const porMes: Record<number, typeof retirosAño> = {};
    retirosAño.forEach((r) => {
      const mes = new Date(r.withdrawal_date).getMonth();
      if (!porMes[mes]) porMes[mes] = [];
      porMes[mes].push(r);
    });

    return Array.from({ length: 12 }, (_, mes) => {
      const lista = porMes[mes] ?? [];
      const bruto = lista.reduce((acc, r) => acc + r.amount, 0);
      const fee = lista.reduce((acc, r) => acc + (r.platform_fee ?? 0), 0);
      const neto = bruto - fee;
      const brl = lista.reduce((acc, r) => acc + (r.brl_amount ?? 0), 0);
      const ptaxList = lista.filter((r) => r.ptax_rate != null).map((r) => r.ptax_rate!);
      const ptaxAvg = ptaxList.length > 0
        ? ptaxList.reduce((a, b) => a + b, 0) / ptaxList.length
        : null;
      return { mes, qty: lista.length, bruto, fee, neto, brl, ptaxAvg };
    }).filter((f) => f.qty > 0);
  }, [retiros, añoElegido]);

  const totalesRetiros = useMemo(() => ({
    qty: filasRetirosMes.reduce((a, f) => a + f.qty, 0),
    bruto: filasRetirosMes.reduce((a, f) => a + f.bruto, 0),
    fee: filasRetirosMes.reduce((a, f) => a + f.fee, 0),
    neto: filasRetirosMes.reduce((a, f) => a + f.neto, 0),
    brl: filasRetirosMes.reduce((a, f) => a + f.brl, 0),
  }), [filasRetirosMes]);

  const totalAportadoAño = useMemo(() => {
    return aportes
      .filter((a) => new Date(a.investment_date).getFullYear() === añoElegido)
      .reduce((acc, a) => acc + a.amount, 0);
  }, [aportes, añoElegido]);

  // ── Tab "P&L": tabla existente mejorada ───────────────────────────
  const filasPnl = useMemo(() => {
    return cuentas
      .map((c) => {
        const cerrados = trades.filter(
          (t) =>
            t.account_id === c.id &&
            t.status === "closed" &&
            t.realized_pnl !== null &&
            new Date(t.entry_time).getFullYear() === añoElegido
        );
        const gananciaBruta = cerrados
          .filter((t) => (t.realized_pnl ?? 0) > 0)
          .reduce((acc, t) => acc + (t.realized_pnl ?? 0), 0);
        const perdidaBruta = Math.abs(
          cerrados.filter((t) => (t.realized_pnl ?? 0) < 0)
            .reduce((acc, t) => acc + (t.realized_pnl ?? 0), 0)
        );
        const neto = gananciaBruta - perdidaBruta;
        const comisiones = cerrados.reduce((acc, t) => acc + (t.fees ?? 0), 0);
        return { cuenta: c, ops: cerrados.length, gananciaBruta, perdidaBruta, neto, comisiones };
      })
      .filter((f) => f.ops > 0);
  }, [trades, cuentas, añoElegido]);

  const totalPnl = useMemo(() => filasPnl.reduce(
    (acc, f) => ({
      ops: acc.ops + f.ops,
      gananciaBruta: acc.gananciaBruta + f.gananciaBruta,
      perdidaBruta: acc.perdidaBruta + f.perdidaBruta,
      neto: acc.neto + f.neto,
      comisiones: acc.comisiones + f.comisiones,
    }),
    { ops: 0, gananciaBruta: 0, perdidaBruta: 0, neto: 0, comisiones: 0 }
  ), [filasPnl]);

  // ── exportar CSV unificado ─────────────────────────────────────────
  function exportarCSV() {
    const lineas: string[][] = [];

    // Sección retiros
    lineas.push([`REPORTE FISCAL ${añoElegido} — KeboTrader`]);
    lineas.push([]);
    lineas.push(["=== RETIROS / PAYOUTS ==="]);
    lineas.push(["Mes", "Retiros", "Bruto (USD)", "Fee plataforma (USD)", "Neto (USD)", "PTAX promedio", "Equivalente BRL"]);
    filasRetirosMes.forEach((f) => {
      lineas.push([
        MESES_CORTOS[f.mes],
        String(f.qty),
        f.bruto.toFixed(2),
        f.fee.toFixed(2),
        f.neto.toFixed(2),
        f.ptaxAvg?.toFixed(4) ?? "",
        f.brl > 0 ? f.brl.toFixed(2) : "",
      ]);
    });
    lineas.push([
      "TOTAL",
      String(totalesRetiros.qty),
      totalesRetiros.bruto.toFixed(2),
      totalesRetiros.fee.toFixed(2),
      totalesRetiros.neto.toFixed(2),
      "",
      totalesRetiros.brl > 0 ? totalesRetiros.brl.toFixed(2) : "",
    ]);

    lineas.push([]);
    lineas.push(["=== P&L POR CUENTA ==="]);
    lineas.push(["Cuenta", "Operaciones", "Ganancia bruta", "Pérdida bruta", "Comisiones", "Neto"]);
    filasPnl.forEach((f) => {
      lineas.push([
        f.cuenta.name,
        String(f.ops),
        f.gananciaBruta.toFixed(2),
        f.perdidaBruta.toFixed(2),
        f.comisiones.toFixed(2),
        f.neto.toFixed(2),
      ]);
    });
    lineas.push([
      "TOTAL", String(totalPnl.ops),
      totalPnl.gananciaBruta.toFixed(2),
      totalPnl.perdidaBruta.toFixed(2),
      totalPnl.comisiones.toFixed(2),
      totalPnl.neto.toFixed(2),
    ]);

    lineas.push([]);
    lineas.push([`Total invertido en challenges ${añoElegido}`, `${totalAportadoAño.toFixed(2)} USD`]);
    lineas.push(["Referencia legal (Brasil)", "Rendimentos Financeiros no Exterior — Lei 14.754/2023 — 15% flat"]);
    lineas.push(["IMPORTANTE", "Este archivo es un resumen de datos. No reemplaza la asesoría de un contador."]);

    const csv = lineas
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kebotrader-fiscal-${añoElegido}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const hayDatos = filasRetirosMes.length > 0 || filasPnl.length > 0;

  return (
    <section className="rounded-xl border border-kb-border bg-kb-surface">
      <button
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <div>
          <h2 className="font-display text-lg font-semibold">📄 Reporte fiscal</h2>
          <p className="text-xs text-kb-text-secondary">
            Retiros, P&amp;L y aportes por año — listo para llevarle a tu contador
          </p>
        </div>
        <span className={`text-kb-text-muted transition-transform ${abierto ? "rotate-180" : ""}`}>⌄</span>
      </button>

      {abierto && (
        <div className="border-t border-kb-border-soft px-5 py-5 space-y-4">
          {/* aviso legal */}
          <div className="rounded-lg border border-kb-accent/30 bg-kb-accent/5 p-3 text-xs text-kb-text-secondary">
            <p>
              <span className="font-semibold text-kb-text">Para uso con tu contador:</span>{" "}
              esta sección agrupa los números por año para simplificar la declaración.
              En Brasil los rendimentos de prop firms del exterior tributan al{" "}
              <span className="font-semibold text-kb-text">15% anual</span> bajo la{" "}
              <span className="font-semibold text-kb-text">Lei 14.754/2023</span>, en la
              ficha "Rendimentos Financeiros no Exterior" del IRPF — pero la declaración
              final la hace un contador, no la app.
            </p>
          </div>

          {añosDisponibles.length === 0 ? (
            <p className="py-6 text-center text-sm text-kb-text-secondary">
              Todavía no hay retiros ni operaciones cerradas para generar un reporte.
            </p>
          ) : (
            <>
              {/* controles */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-kb-text-secondary">Año:</label>
                  <select
                    value={añoElegido}
                    onChange={(e) => setAñoElegido(Number(e.target.value))}
                    className={inputClass + " !w-auto"}
                  >
                    {añosDisponibles.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={exportarCSV}
                    className="rounded-lg border border-kb-border px-3 py-2 text-xs font-medium text-kb-text-secondary hover:border-kb-accent hover:text-kb-accent transition-colors"
                  >
                    📥 Exportar CSV
                  </button>
                  <button
                    onClick={() => window.print()}
                    className="rounded-lg border border-kb-border px-3 py-2 text-xs font-medium text-kb-text-secondary hover:border-kb-accent hover:text-kb-accent transition-colors"
                  >
                    🖨️ Imprimir
                  </button>
                </div>
              </div>

              {/* tabs */}
              <div className="flex gap-1 rounded-lg border border-kb-border-soft bg-kb-bg p-1">
                {(["retiros", "pnl"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                      tab === t
                        ? "bg-kb-surface text-kb-text shadow-sm"
                        : "text-kb-text-secondary hover:text-kb-text"
                    }`}
                  >
                    {t === "retiros" ? "💸 Retiros / Payouts" : "📊 P&L por cuenta"}
                  </button>
                ))}
              </div>

              {/* ── TAB: retiros ── */}
              {tab === "retiros" && (
                <div className="space-y-3">
                  {filasRetirosMes.length === 0 ? (
                    <p className="py-6 text-center text-sm text-kb-text-secondary">
                      No hay retiros registrados en {añoElegido}. Cargalos en la sección Retiros.
                    </p>
                  ) : (
                    <>
                      <div className="overflow-x-auto rounded-lg border border-kb-border-soft">
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="border-b border-kb-border-soft text-xs text-kb-text-secondary">
                              <th className="px-4 py-3 font-medium">Mes</th>
                              <th className="px-4 py-3 font-medium text-center">Retiros</th>
                              <th className="px-4 py-3 font-medium text-right">Bruto (USD)</th>
                              <th className="px-4 py-3 font-medium text-right">Fee</th>
                              <th className="px-4 py-3 font-medium text-right">Neto (USD)</th>
                              <th className="px-4 py-3 font-medium text-right">PTAX prom.</th>
                              <th className="px-4 py-3 font-medium text-right">Neto (BRL)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filasRetirosMes.map((f) => (
                              <tr key={f.mes} className="border-b border-kb-border-soft hover:bg-kb-bg/40">
                                <td className="px-4 py-3 font-medium text-kb-text">{MESES_CORTOS[f.mes]}</td>
                                <td className="px-4 py-3 text-center text-kb-text-secondary">{f.qty}</td>
                                <td className="px-4 py-3 text-right font-mono text-kb-text">{formatCurrency(f.bruto)}</td>
                                <td className="px-4 py-3 text-right font-mono text-kb-loss">
                                  {f.fee > 0 ? `-${formatCurrency(f.fee)}` : "—"}
                                </td>
                                <td className="px-4 py-3 text-right font-mono font-semibold text-kb-gain">
                                  {formatCurrency(f.neto)}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-kb-text-secondary text-xs">
                                  {f.ptaxAvg ? f.ptaxAvg.toFixed(4) : "—"}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-kb-accent">
                                  {f.brl > 0 ? `R$ ${f.brl.toFixed(2)}` : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-kb-border font-semibold">
                              <td className="px-4 py-3 text-kb-text">Total {añoElegido}</td>
                              <td className="px-4 py-3 text-center text-kb-text-secondary">{totalesRetiros.qty}</td>
                              <td className="px-4 py-3 text-right font-mono text-kb-text">{formatCurrency(totalesRetiros.bruto)}</td>
                              <td className="px-4 py-3 text-right font-mono text-kb-loss">
                                {totalesRetiros.fee > 0 ? `-${formatCurrency(totalesRetiros.fee)}` : "—"}
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-kb-gain">{formatCurrency(totalesRetiros.neto)}</td>
                              <td className="px-4 py-3"></td>
                              <td className="px-4 py-3 text-right font-mono text-kb-accent">
                                {totalesRetiros.brl > 0 ? `R$ ${totalesRetiros.brl.toFixed(2)}` : "—"}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>

                      {/* resumen + estimativa */}
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="rounded-lg border border-kb-border-soft bg-kb-bg p-3">
                          <p className="text-[11px] text-kb-text-secondary">Neto recibido (USD)</p>
                          <p className="mt-0.5 font-mono text-base font-bold text-kb-gain">{formatCurrency(totalesRetiros.neto)}</p>
                        </div>
                        <div className="rounded-lg border border-kb-border-soft bg-kb-bg p-3">
                          <p className="text-[11px] text-kb-text-secondary">Equivalente BRL</p>
                          <p className="mt-0.5 font-mono text-base font-bold text-kb-accent">
                            {totalesRetiros.brl > 0 ? `R$ ${totalesRetiros.brl.toFixed(2)}` : "Cargar PTAX"}
                          </p>
                        </div>
                        <div className="rounded-lg border border-kb-gain/20 bg-kb-gain/5 p-3">
                          <p className="text-[11px] text-kb-text-secondary">Estimativa IR (15% × BRL)</p>
                          <p className="mt-0.5 font-mono text-base font-bold text-kb-text">
                            {totalesRetiros.brl > 0
                              ? `R$ ${(totalesRetiros.brl * 0.15).toFixed(2)}`
                              : "—"}
                          </p>
                          <p className="mt-1 text-[10px] text-kb-text-muted">Lei 14.754/2023 · valor referencial</p>
                        </div>
                      </div>

                      {totalAportadoAño > 0 && (
                        <div className="rounded-lg border border-kb-border-soft bg-kb-bg/60 px-4 py-3 text-xs text-kb-text-secondary">
                          <span className="font-medium text-kb-text">Total invertido en challenges {añoElegido}:</span>{" "}
                          <span className="font-mono">{formatCurrency(totalAportadoAño)}</span>{" "}
                          — este monto no es deducible automáticamente pero es relevante para calcular el lucro neto real; consultá con tu contador cómo declararlo.
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── TAB: P&L ── */}
              {tab === "pnl" && (
                <div>
                  {filasPnl.length === 0 ? (
                    <p className="py-6 text-center text-sm text-kb-text-secondary">
                      No hay operaciones cerradas en {añoElegido}.
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-kb-border-soft">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-kb-border-soft text-xs text-kb-text-secondary">
                            <th className="px-4 py-3 font-medium">Cuenta</th>
                            <th className="px-4 py-3 font-medium text-center">Ops</th>
                            <th className="px-4 py-3 font-medium text-right">Ganancia</th>
                            <th className="px-4 py-3 font-medium text-right">Pérdida</th>
                            <th className="px-4 py-3 font-medium text-right">Comisiones</th>
                            <th className="px-4 py-3 font-medium text-right">Neto</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filasPnl.map((f) => (
                            <tr key={f.cuenta.id} className="border-b border-kb-border-soft hover:bg-kb-bg/40">
                              <td className="px-4 py-3 font-medium text-kb-text">{f.cuenta.name}</td>
                              <td className="px-4 py-3 text-center text-kb-text-secondary">{f.ops}</td>
                              <td className="px-4 py-3 text-right font-mono text-kb-gain">{formatCurrency(f.gananciaBruta)}</td>
                              <td className="px-4 py-3 text-right font-mono text-kb-loss">{formatCurrency(f.perdidaBruta)}</td>
                              <td className="px-4 py-3 text-right font-mono text-kb-text-secondary">{formatCurrency(f.comisiones)}</td>
                              <td className={`px-4 py-3 text-right font-mono font-semibold ${f.neto >= 0 ? "text-kb-gain" : "text-kb-loss"}`}>
                                {formatCurrency(f.neto)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-kb-border font-semibold">
                            <td className="px-4 py-3 text-kb-text">Total {añoElegido}</td>
                            <td className="px-4 py-3 text-center text-kb-text-secondary">{totalPnl.ops}</td>
                            <td className="px-4 py-3 text-right font-mono text-kb-gain">{formatCurrency(totalPnl.gananciaBruta)}</td>
                            <td className="px-4 py-3 text-right font-mono text-kb-loss">{formatCurrency(totalPnl.perdidaBruta)}</td>
                            <td className="px-4 py-3 text-right font-mono text-kb-text-secondary">{formatCurrency(totalPnl.comisiones)}</td>
                            <td className={`px-4 py-3 text-right font-mono ${totalPnl.neto >= 0 ? "text-kb-gain" : "text-kb-loss"}`}>
                              {formatCurrency(totalPnl.neto)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
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
  // ── estado del formulario ──────────────────────────────────────────
  const cuentaParaRetiro = cuentaActivaId === "todas" ? "" : cuentaActivaId;
  const [accountId, setAccountId] = useState(cuentaParaRetiro || cuentas[0]?.id || "");
  const [grossStr, setGrossStr] = useState("");          // monto bruto
  const [feeStr, setFeeStr] = useState("");              // fee plataforma
  const [paymentMethod, setPaymentMethod] = useState("Binance");
  const [ptaxStr, setPtaxStr] = useState("");            // tasa PTAX
  const [brlStr, setBrlStr] = useState("");              // BRL (editable)
  const [receivedUsdtStr, setReceivedUsdtStr] = useState(""); // USDT recibidos en Binance
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [proofPixFile, setProofPixFile] = useState<File | null>(null);
  const [proofPixPreview, setProofPixPreview] = useState<string | null>(null);
  const [subiendoPrueba, setSubiendoPrueba] = useState(false);
  const [fecha, setFecha] = useState(() => todayKey());
  const [notes, setNotes] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exitoRetiro, setExitoRetiro] = useState(false);
  const exitoRetiroTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (exitoRetiroTimerRef.current) clearTimeout(exitoRetiroTimerRef.current); }, []);
  const [buscandoPtax, setBuscandoPtax] = useState(false);
  const [ptaxMensaje, setPtaxMensaje] = useState<string | null>(null);
  const [mostrarGuia, setMostrarGuia] = useState(false);
  const [confirmandoEliminarId, setConfirmandoEliminarId] = useState<string | null>(null);

  async function buscarPtax() {
    if (!fecha) return;
    setBuscandoPtax(true);
    setPtaxMensaje(null);
    try {
      // API pública del Banco Central de Brasil — PTAX cotação dólar
      // Formato de fecha requerido: MM-DD-YYYY
      const [y, m, d] = fecha.split("-");
      const dataFormatada = `${m}-${d}-${y}`;
      const url =
        `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/` +
        `CotacaoDolarDia(dataCotacao=@dataCotacao)?@dataCotacao='${dataFormatada}'` +
        `&$top=1&$format=json&$select=cotacaoVenda`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`BCB respondió ${res.status}`);
      const json = await res.json();
      const cotacao: number | undefined = json?.value?.[0]?.cotacaoVenda;
      if (cotacao) {
        setPtaxStr(String(cotacao));
        setPtaxMensaje(`✓ PTAX de venda: R$ ${cotacao.toFixed(4)}`);
      } else {
        // Fin de semana o feriado → no hay PTAX
        setPtaxMensaje("Sin PTAX para esa fecha (feriado/fin de semana). Usá la del día hábil anterior.");
      }
    } catch {
      setPtaxMensaje("No se pudo conectar al BCB. Ingresá la tasa manualmente.");
    } finally {
      setBuscandoPtax(false);
    }
  }

  function seleccionarPrueba(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setProofFile(f);
    setProofPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return f ? URL.createObjectURL(f) : null;
    });
  }

  function seleccionarPruebaPix(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setProofPixFile(f);
    setProofPixPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return f ? URL.createObjectURL(f) : null;
    });
  }

  const gross = parseFloat(grossStr) || 0;
  const fee = parseFloat(feeStr) || 0;
  const neto = gross - fee;
  const ptax = parseFloat(ptaxStr) || 0;

  // ── auto-calcular BRL tributável (neto × PTAX) — siempre automático ──
  useEffect(() => {
    if (neto > 0 && ptax > 0) {
      setBrlStr((neto * ptax).toFixed(2));
    } else {
      setBrlStr("");
    }
  }, [neto, ptax]);

  // ── totales del historial ──────────────────────────────────────────
  const totales = useMemo(() => {
    const r = retiros;
    const bruto = r.reduce((acc, x) => acc + x.amount, 0);
    const feeTotal = r.reduce((acc, x) => acc + (x.platform_fee ?? 0), 0);
    const neto = bruto - feeTotal;
    const brl = r.reduce((acc, x) => acc + (x.brl_amount ?? 0), 0);
    return { bruto, feeTotal, neto, brl };
  }, [retiros]);

  // ── envío ──────────────────────────────────────────────────────────
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const monto = parseFloat(grossStr);
    if (!accountId || Number.isNaN(monto) || monto <= 0) {
      setError("Seleccioná una cuenta e ingresá un monto bruto válido.");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setError("Tu sesión expiró. Volvé a iniciar sesión.");
      return;
    }

    const feeVal = parseFloat(feeStr) || null;
    const ptaxVal = parseFloat(ptaxStr) || null;
    const brlVal = parseFloat(brlStr) || null;
    const receivedUsdtVal = parseFloat(receivedUsdtStr) || null;

    // ── subir comprobantes (Binance y PIX) ──────────────────────────
    setSubiendoPrueba(true);
    let proofUrl: string | null = null;
    let proofPixUrl: string | null = null;

    async function subirArchivo(file: File, sufijo: string): Promise<string | null> {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${userId}/${Date.now()}-${sufijo}.${ext}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("withdrawal-proofs")
        .upload(path, file, { upsert: false });
      if (uploadError) {
        setError(`No se pudo subir el comprobante de ${sufijo} (${uploadError.message}), pero el retiro se guardará igual.`);
        return null;
      }
      const { data: urlData } = supabase.storage.from("withdrawal-proofs").getPublicUrl(uploadData.path);
      return urlData.publicUrl;
    }

    if (proofFile) proofUrl = await subirArchivo(proofFile, "binance");
    if (proofPixFile) proofPixUrl = await subirArchivo(proofPixFile, "pix");
    setSubiendoPrueba(false);

    setEnviando(true);
    const { error: insertError } = await conReintento(() =>
      supabase.from("withdrawals").insert({
        user_id: userId,
        account_id: accountId,
        amount: monto,
        platform_fee: feeVal,
        payment_method: paymentMethod.trim() || null,
        ptax_rate: ptaxVal,
        brl_amount: brlVal,
        received_usdt: receivedUsdtVal,
        proof_url: proofUrl,
        proof_pix_url: proofPixUrl,
        withdrawal_date: fecha,
        notes: notes.trim() === "" ? null : notes.trim(),
      })
    );
    setEnviando(false);

    if (insertError) {
      setError(
        `No se pudo registrar el retiro. Revisá tu conexión e intentá de nuevo. Detalle: ${insertError.message}`
      );
      return;
    }

    // limpiar formulario
    setGrossStr("");
    setFeeStr("");
    setPtaxStr("");
    setBrlStr("");
    setReceivedUsdtStr("");
    setProofFile(null);
    setProofPreview(null);
    setProofPixFile(null);
    setProofPixPreview(null);
    setNotes("");
    setExitoRetiro(true);
    if (exitoRetiroTimerRef.current) clearTimeout(exitoRetiroTimerRef.current);
    exitoRetiroTimerRef.current = setTimeout(() => setExitoRetiro(false), 4000);
    onCambio();
  }

  async function eliminar(id: string) {
    const { error: deleteError } = await supabase.from("withdrawals").delete().eq("id", id);
    if (deleteError) {
      setError("No se pudo eliminar el retiro. Intenta de nuevo.");
      return;
    }
    onCambio();
  }

  // ── exportar CSV fiscal ────────────────────────────────────────────
  function exportarCSV() {
    // Cabecera en portugués para facilitar el trabajo con el contador
    const header = [
      "Data", "Conta", "Valor bruto (USD)", "Fee plataforma (USD)",
      "Neto recebido (USD)", "USDT Binance", "Taxa PTAX (BRL/USD)",
      "BRL tributável (Carnê-Leão)", "Método de recebimento", "Observações", "Comprovante Binance", "Comprovante PIX",
    ];
    const rows = retiros.map((r) => {
      const conta = cuentas.find((c) => c.id === r.account_id)?.name ?? "—";
      const fee = r.platform_fee ?? 0;
      const neto = r.amount - fee;
      return [
        r.withdrawal_date,
        conta,
        r.amount.toFixed(2),
        fee.toFixed(2),
        neto.toFixed(2),
        r.received_usdt?.toFixed(2) ?? "",
        r.ptax_rate?.toFixed(4) ?? "",
        r.brl_amount?.toFixed(2) ?? "",
        r.payment_method ?? "",
        r.notes ?? "",
        r.proof_url ?? "",
        r.proof_pix_url ?? "",
      ];
    });
    const csv = [header, ...rows]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }); // BOM para Excel
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `retiradas-kebotrader-${new Date().getFullYear()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-kb-text">Retiros</h1>
          <p className="mt-0.5 text-sm text-kb-text-secondary">
            {retiros.length === 0
              ? "Todavía no registraste ningún retiro."
              : `${retiros.length} retiro${retiros.length === 1 ? "" : "s"} · ${formatCurrency(totales.bruto)} bruto · ${formatCurrency(totales.neto)} neto`}
          </p>
        </div>
        {retiros.length > 0 && (
          <button
            onClick={exportarCSV}
            className="shrink-0 rounded-lg border border-kb-border-soft bg-kb-surface px-3 py-2 text-xs font-medium text-kb-text-secondary hover:text-kb-text hover:border-kb-gain/40 transition-colors"
          >
            📥 Exportar CSV fiscal
          </button>
        )}
      </div>

      {/* ── guía contextual colapsable ────────────────────────── */}
      <div className="rounded-xl border border-kb-border bg-kb-surface overflow-hidden">
        <button
          type="button"
          onClick={() => setMostrarGuia((v) => !v)}
          className="flex w-full items-center justify-between px-5 py-3.5 text-left hover:bg-kb-bg/60 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <span className="text-sm">📖</span>
            <span className="text-sm font-semibold text-kb-text">¿Cómo funciona esta sección?</span>
            <span className="text-[11px] text-kb-text-muted">— formulario, PTAX, CSV fiscal</span>
          </div>
          <span className="text-kb-text-muted transition-transform duration-200" style={{ display: "inline-block", transform: mostrarGuia ? "rotate(180deg)" : "rotate(0deg)" }}>
            ▾
          </span>
        </button>

        {mostrarGuia && (
          <div className="border-t border-kb-border-soft px-5 py-5 space-y-8">

            {/* ── Formulario 3 secciones ── */}
            <div className="space-y-4">
              <div className="flex items-center gap-2.5 pb-2.5 border-b border-kb-border-soft">
                <span>💸</span>
                <h3 className="font-display text-sm font-semibold text-kb-text">El formulario tiene 3 secciones con propósitos distintos</h3>
              </div>

              {/* Mock visual compacto del form */}
              <div className="rounded-xl border border-kb-border bg-kb-bg overflow-hidden text-[12px]">
                {/* A */}
                <div className="p-3.5 space-y-2 border-b border-kb-border-soft">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-kb-text-muted">A — El retiro</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-kb-surface border border-kb-border-soft px-2.5 py-1.5">
                      <p className="text-[10px] text-kb-text-muted">Monto bruto (USD)</p>
                      <p className="font-mono font-semibold text-kb-text">$500.00</p>
                    </div>
                    <div className="rounded-lg bg-kb-surface border border-kb-border-soft px-2.5 py-1.5">
                      <p className="text-[10px] text-kb-text-muted">Fee plataforma</p>
                      <p className="font-mono font-semibold text-kb-text">$50.00</p>
                    </div>
                  </div>
                  <div className="rounded-lg bg-kb-gain/10 border border-kb-gain/20 px-2.5 py-1.5">
                    <p className="text-[10px] text-kb-text-secondary">Neto que llega a tu billetera</p>
                    <p className="font-mono font-bold text-kb-gain">$450.00</p>
                  </div>
                </div>
                {/* B */}
                <div className="p-3.5 space-y-2 border-b border-kb-border-soft bg-kb-accent/5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-kb-accent">B — Para o Contador (Carnê-Leão)</p>
                  <div className="flex gap-2 items-center">
                    <div className="flex-1 rounded-lg bg-kb-surface border border-kb-accent/30 px-2.5 py-1.5">
                      <p className="text-[10px] text-kb-text-muted">Taxa PTAX</p>
                      <p className="font-mono font-semibold text-kb-accent">5.8850</p>
                    </div>
                    <div className="rounded-lg border border-kb-accent/30 bg-kb-accent/10 px-2.5 py-1.5 text-[11px] font-bold text-kb-accent">BCB</div>
                  </div>
                  <div className="rounded-lg bg-kb-gain/10 border border-kb-gain/20 px-2.5 py-1.5">
                    <p className="text-[10px] text-kb-text-secondary">BRL tributável (base de cálculo IRPF)</p>
                    <p className="font-mono text-base font-bold text-kb-gain">R$ 2.648,25</p>
                    <p className="text-[10px] text-kb-text-muted mt-0.5">= $450.00 × 5.8850 PTAX</p>
                  </div>
                </div>
                {/* C */}
                <div className="p-3.5 space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#0EA5E9" }}>C — O que chegou na sua carteira</p>
                  <div className="rounded-lg bg-kb-surface border border-kb-border-soft px-2.5 py-1.5">
                    <p className="text-[10px] text-kb-text-muted">USDT recebidos no Binance</p>
                    <p className="font-mono font-semibold" style={{ color: "#38BDF8" }}>448.20 USDT</p>
                  </div>
                  <div className="rounded-lg border border-dashed border-kb-border-soft px-2.5 py-1.5 text-[11px] text-kb-text-muted flex items-center gap-2">
                    📷 Subir comprobante de recibo (opcional)
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {[
                  { n: "A", t: "El retiro", d: "Bruto que pagó la prop firm, el fee que retuvieron (10% se calcula solo) y el neto. Siempre en USD." },
                  { n: "B", t: "Para o Contador — Carnê-Leão", d: "Poné la fecha en A, hacé clic en BCB y la PTAX del Banco Central aparece sola. El BRL tributável se calcula automático. Ese número es lo que va en la declaración." },
                  { n: "C", t: "O que chegou na sua carteira", d: "Cuántos USDT llegaron a Binance y la captura del comprobante. Registro personal y evidencia para el contador." },
                ].map(({ n, t, d }) => (
                  <div key={n} className="flex gap-3 items-start">
                    <div className="shrink-0 mt-0.5 w-6 h-6 rounded-full bg-kb-bg border border-kb-border-soft flex items-center justify-center text-[11px] font-bold text-kb-text-muted">{n}</div>
                    <div>
                      <p className="text-sm font-semibold text-kb-text">{t}</p>
                      <p className="text-[13px] text-kb-text-secondary mt-0.5 leading-relaxed">{d}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── PTAX ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 pb-2.5 border-b border-kb-border-soft">
                <span>🏦</span>
                <h3 className="font-display text-sm font-semibold text-kb-text">PTAX automático del Banco Central</h3>
              </div>
              <div className="space-y-3">
                {[
                  { n: "1", t: "Poné la fecha en que recibiste el dinero", d: "El botón BCB usa esa fecha exacta para buscar la cotización oficial." },
                  { n: "2", t: "Hacé clic en BCB", d: "Consulta la API pública del Banco Central de Brasil y trae el PTAX de venda del día." },
                  { n: "3", t: "Si fue fin de semana o feriado", d: "El BCB no publica PTAX esos días. La app te avisa. En ese caso ingresás la tasa del último día hábil anterior manualmente." },
                ].map(({ n, t, d }) => (
                  <div key={n} className="flex gap-3 items-start">
                    <div className="shrink-0 mt-0.5 w-6 h-6 rounded-full bg-kb-bg border border-kb-border-soft flex items-center justify-center text-[11px] font-bold text-kb-text-muted">{n}</div>
                    <div>
                      <p className="text-sm font-semibold text-kb-text">{t}</p>
                      <p className="text-[13px] text-kb-text-secondary mt-0.5 leading-relaxed">{d}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="rounded-xl border border-kb-border-soft bg-kb-bg/60 px-4 py-3 text-[12px] text-kb-text-muted">
                ⚠️ La PTAX que usa el Carnê-Leão es la <strong className="text-kb-text">de venda</strong>, no la de compra. El botón BCB ya trae la correcta.
              </div>
            </div>

            {/* ── CSV fiscal ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 pb-2.5 border-b border-kb-border-soft">
                <span>📊</span>
                <h3 className="font-display text-sm font-semibold text-kb-text">Exportar CSV para el contador</h3>
              </div>
              <div className="space-y-3">
                {[
                  { n: "1", t: "Hacé clic en \"📥 Exportar CSV fiscal\"", d: "Está en la esquina superior derecha de esta sección. Solo aparece cuando ya tenés retiros registrados." },
                  { n: "2", t: "Mandáselo al contador", d: "Se descarga como retiradas-kebotrader-2026.csv. Abre en Excel con los caracteres en portugués correctos." },
                ].map(({ n, t, d }) => (
                  <div key={n} className="flex gap-3 items-start">
                    <div className="shrink-0 mt-0.5 w-6 h-6 rounded-full bg-kb-bg border border-kb-border-soft flex items-center justify-center text-[11px] font-bold text-kb-text-muted">{n}</div>
                    <div>
                      <p className="text-sm font-semibold text-kb-text">{t}</p>
                      <p className="text-[13px] text-kb-text-secondary mt-0.5 leading-relaxed">{d}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto rounded-xl border border-kb-border bg-kb-bg">
                <table className="w-full text-left text-[11px] font-mono">
                  <thead>
                    <tr className="border-b border-kb-border-soft text-[10px] text-kb-text-muted">
                      {["Data","Conta","Bruto","Fee","Neto","USDT","PTAX","BRL tributável","Método"].map((h) => (
                        <th key={h} className="px-3 py-2 whitespace-nowrap font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="text-kb-text-secondary">
                      <td className="px-3 py-2 whitespace-nowrap">2026-09-30</td>
                      <td className="px-3 py-2 whitespace-nowrap">LucidFlex NQ</td>
                      <td className="px-3 py-2 text-kb-gain font-semibold">500.00</td>
                      <td className="px-3 py-2">50.00</td>
                      <td className="px-3 py-2 text-kb-gain font-semibold">450.00</td>
                      <td className="px-3 py-2">448.20</td>
                      <td className="px-3 py-2">5.8850</td>
                      <td className="px-3 py-2 text-kb-accent font-semibold">2648.25</td>
                      <td className="px-3 py-2">Binance</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-[12px] text-kb-text-muted">
                La columna <span className="font-semibold text-kb-accent">BRL tributável</span> es lo que el contador usa directamente en el Carnê-Leão. No tiene que calcular nada.
              </p>
            </div>

          </div>
        )}
      </div>

      {/* totales rápidos */}
      {retiros.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Total bruto (USD)", value: formatCurrency(totales.bruto), color: "text-kb-text" },
            { label: "Total fee plataforma", value: formatCurrency(totales.feeTotal), color: "text-kb-loss" },
            { label: "Total neto (USD)", value: formatCurrency(totales.neto), color: "text-kb-gain" },
            { label: "Total en BRL", value: totales.brl > 0 ? `R$ ${totales.brl.toFixed(2)}` : "—", color: "text-kb-accent" },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl border border-kb-border-soft bg-kb-surface p-3">
              <p className="text-[11px] text-kb-text-secondary">{label}</p>
              <p className={`mt-0.5 font-mono text-base font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        {/* ── formulario ─────────────────────────────────────── */}
        <section className="h-fit rounded-xl border border-kb-border bg-kb-surface p-5">
          <h2 className="font-display text-base font-semibold mb-1">Registrar retiro</h2>
          <p className="mb-4 text-xs text-kb-text-secondary">
            Cada retiro ajusta tu balance y tu rentabilidad automáticamente.
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

              <Campo etiqueta="Fecha de recibo">
                <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputClass} />
              </Campo>

              {/* fila bruto + fee */}
              <div className="grid grid-cols-2 gap-2">
                <Campo etiqueta="Monto bruto (USD)">
                  <input
                    required
                    type="number"
                    step="any"
                    min="0.01"
                    value={grossStr}
                    onChange={(e) => setGrossStr(e.target.value)}
                    placeholder="Ej. 500"
                    className={inputClass}
                  />
                </Campo>
                <Campo etiqueta="Fee plataforma (USD)">
                  <div className="flex gap-1">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={feeStr}
                      onChange={(e) => setFeeStr(e.target.value)}
                      placeholder="Ej. 50"
                      className={`${inputClass} flex-1`}
                    />
                    {gross > 0 && (
                      <button
                        type="button"
                        onClick={() => setFeeStr((gross * 0.1).toFixed(2))}
                        className="shrink-0 rounded-lg border border-kb-border-soft bg-kb-bg px-2 text-[11px] text-kb-text-muted hover:text-kb-text transition-colors"
                        title="Aplicar 10% automático"
                      >
                        10%
                      </button>
                    )}
                  </div>
                </Campo>
              </div>

              {/* neto calculado */}
              {gross > 0 && (
                <div className="rounded-lg bg-kb-gain/10 border border-kb-gain/20 px-3 py-2">
                  <p className="text-[11px] text-kb-text-secondary">Neto que llega a tu billetera</p>
                  <p className="font-mono font-bold text-kb-gain">{formatCurrency(neto)}</p>
                </div>
              )}

              {/* ── SECCIÓN B: Para o Contador (Carnê-Leão) ── */}
              <div className="rounded-xl border border-kb-accent/20 bg-kb-accent/5 p-3 space-y-2.5">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-kb-text-secondary">
                    📋 Para o contador — Carnê-Leão
                  </p>
                  <p className="text-[11px] text-kb-text-muted mt-0.5">
                    Renda do exterior é declarada em BRL usando a PTAX do dia do recebimento.
                  </p>
                </div>

                <Campo etiqueta="Taxa PTAX (BRL/USD)">
                  <div className="flex gap-1">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={ptaxStr}
                      onChange={(e) => { setPtaxStr(e.target.value); setPtaxMensaje(null); }}
                      placeholder="Ej. 5.85"
                      className={`${inputClass} flex-1`}
                    />
                    <button
                      type="button"
                      onClick={buscarPtax}
                      disabled={buscandoPtax || !fecha}
                      title="Buscar PTAX do Banco Central para a data selecionada"
                      className="shrink-0 rounded-lg border border-kb-accent/40 bg-kb-accent/10 px-2 text-[11px] font-semibold text-kb-accent hover:bg-kb-accent/20 transition-colors disabled:opacity-50"
                    >
                      {buscandoPtax ? "…" : "BCB"}
                    </button>
                  </div>
                </Campo>

                {ptaxMensaje && (
                  <p className={`text-[11px] -mt-1 ${ptaxMensaje.startsWith("✓") ? "text-kb-gain" : "text-kb-text-muted"}`}>
                    {ptaxMensaje}
                  </p>
                )}

                {/* BRL tributável — siempre auto-calculado, solo lectura */}
                {brlStr ? (
                  <div className="rounded-lg bg-kb-gain/10 border border-kb-gain/20 px-3 py-2">
                    <p className="text-[11px] text-kb-text-secondary">BRL tributável (base de cálculo IRPF)</p>
                    <p className="font-mono text-lg font-bold text-kb-gain">R$ {brlStr}</p>
                    <p className="text-[11px] text-kb-text-muted mt-0.5">
                      = {formatCurrency(neto)} neto × {ptaxStr} PTAX — este valor vai no Carnê-Leão
                    </p>
                  </div>
                ) : (
                  <p className="text-[11px] text-kb-text-muted">
                    Clique em <span className="font-semibold text-kb-accent">BCB</span> para buscar a PTAX automaticamente e calcular a base tributável.
                  </p>
                )}
              </div>

              {/* ── SECCIÓN C: O que chegou na carteira ── */}
              <div className="rounded-xl border border-kb-border-soft bg-kb-bg/60 p-3 space-y-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-kb-text-secondary">
                  💰 O que chegou na sua carteira
                </p>

                <Campo etiqueta="Método de recebimento">
                  <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={inputClass}>
                    <option value="Binance">Binance (USDT)</option>
                    <option value="PayPal">PayPal</option>
                    <option value="Transferencia bancaria">Transferência bancária</option>
                    <option value="Wise">Wise</option>
                    <option value="Otro">Outro</option>
                  </select>
                </Campo>

                <Campo etiqueta="USDT recebidos no Binance" ayuda="Quantidade exata creditada na sua conta">
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={receivedUsdtStr}
                    onChange={(e) => setReceivedUsdtStr(e.target.value)}
                    placeholder="Ej. 448.20"
                    className={inputClass}
                  />
                </Campo>

                {/* Comprovantes — Binance y PIX */}
                <div className="space-y-3">
                  <p className="text-[11px] text-kb-text-secondary font-medium">Comprovantes (opcionais)</p>

                  {/* Binance */}
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-kb-text-muted">📷 Binance — recibo USDT</p>
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-kb-border-soft bg-kb-bg px-3 py-2.5 text-xs text-kb-text-secondary hover:border-kb-accent/50 hover:text-kb-accent transition-colors">
                      <span>{proofFile ? "✓ " + proofFile.name : "Subir captura de Binance"}</span>
                      <input type="file" accept="image/*,.pdf" className="hidden" onChange={seleccionarPrueba} />
                    </label>
                    {proofPreview && (
                      <div className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={proofPreview} alt="Binance" className="w-full rounded-lg border border-kb-border-soft" style={{ maxHeight: "100px", objectFit: "contain" }} />
                        <button type="button" onClick={() => { setProofFile(null); setProofPreview(null); }} className="absolute right-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white hover:bg-black/80">✕</button>
                      </div>
                    )}
                  </div>

                  {/* PIX */}
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-kb-text-muted">🏦 PIX — comprovante bancário</p>
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-kb-border-soft bg-kb-bg px-3 py-2.5 text-xs text-kb-text-secondary hover:border-kb-accent/50 hover:text-kb-accent transition-colors">
                      <span>{proofPixFile ? "✓ " + proofPixFile.name : "Subir comprovante de PIX"}</span>
                      <input type="file" accept="image/*,.pdf" className="hidden" onChange={seleccionarPruebaPix} />
                    </label>
                    {proofPixPreview && (
                      <div className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={proofPixPreview} alt="PIX" className="w-full rounded-lg border border-kb-border-soft" style={{ maxHeight: "100px", objectFit: "contain" }} />
                        <button type="button" onClick={() => { setProofPixFile(null); setProofPixPreview(null); }} className="absolute right-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white hover:bg-black/80">✕</button>
                      </div>
                    )}
                  </div>

                  {subiendoPrueba && (
                    <p className="text-[11px] text-kb-text-muted animate-pulse">Subindo comprovantes…</p>
                  )}
                </div>
              </div>

              <Campo etiqueta="Observações (opcional)">
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ex. Primeiro payout LucidFlex"
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

              {exitoRetiro && (
                <p className="mt-2 rounded-lg border border-kb-gain/30 bg-kb-gain/10 px-3 py-2 text-center text-xs font-semibold text-kb-gain">
                  ✓ Retiro registrado correctamente
                </p>
              )}
            </form>
          )}
        </section>

        {/* ── historial ──────────────────────────────────────── */}
        <section className="overflow-hidden rounded-xl border border-kb-border bg-kb-surface">
          <div className="flex items-center justify-between border-b border-kb-border-soft px-5 py-4">
            <h2 className="font-display text-base font-semibold">Historial</h2>
            {retiros.length > 0 && (
              <span className="rounded-full bg-kb-gain/10 px-3 py-1 text-xs font-semibold text-kb-gain">
                {formatCurrency(totales.neto)} neto recibido
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
                    <th className="px-4 py-3 font-medium">Fecha</th>
                    <th className="px-4 py-3 font-medium">Cuenta</th>
                    <th className="px-4 py-3 font-medium text-right">Bruto</th>
                    <th className="px-4 py-3 font-medium text-right">Fee</th>
                    <th className="px-4 py-3 font-medium text-right">Neto (USD)</th>
                    <th className="px-4 py-3 font-medium text-right">USDT Binance</th>
                    <th className="px-4 py-3 font-medium text-right">PTAX</th>
                    <th className="px-4 py-3 font-medium text-right">BRL tributável</th>
                    <th className="px-4 py-3 font-medium">Método</th>
                    <th className="px-4 py-3 font-medium">Notas</th>
                    <th className="px-4 py-3 font-medium text-center" title="Comprobante Binance">🪙</th>
                    <th className="px-4 py-3 font-medium text-center" title="Comprobante PIX">🏦</th>
                    <th className="px-4 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {retiros.map((r) => {
                    const cuentaDelRetiro = cuentas.find((c) => c.id === r.account_id);
                    const feeVal = r.platform_fee ?? 0;
                    const netoVal = r.amount - feeVal;
                    return (
                      <tr key={r.id} className="border-b border-kb-border-soft last:border-0 hover:bg-kb-bg/40 transition-colors">
                        <td className="px-4 py-3 text-kb-text-secondary whitespace-nowrap">{formatDateOnly(r.withdrawal_date)}</td>
                        <td className="px-4 py-3 font-medium text-kb-text whitespace-nowrap">
                          {cuentaDelRetiro?.name ?? "Cuenta eliminada"}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-kb-text">
                          {formatCurrency(r.amount)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-kb-loss">
                          {feeVal > 0 ? `-${formatCurrency(feeVal)}` : <span className="text-kb-text-muted">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-kb-gain">
                          {formatCurrency(netoVal)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-kb-text-secondary text-xs">
                          {r.received_usdt != null
                            ? <span className="text-yellow-400 font-semibold">{r.received_usdt.toFixed(2)} <span className="font-normal text-kb-text-muted">USDT</span></span>
                            : <span className="text-kb-text-muted">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-kb-text-secondary text-xs">
                          {r.ptax_rate ? r.ptax_rate.toFixed(4) : <span className="text-kb-text-muted">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-kb-accent">
                          {r.brl_amount ? `R$ ${r.brl_amount.toFixed(2)}` : <span className="text-kb-text-muted">—</span>}
                        </td>
                        <td className="px-4 py-3 text-kb-text-muted text-xs whitespace-nowrap">
                          {r.payment_method ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-kb-text-muted max-w-[140px] truncate text-xs">
                          {r.notes ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {r.proof_url ? (
                            <a href={r.proof_url} target="_blank" rel="noopener noreferrer" title="Comprobante Binance" className="text-base hover:opacity-70 transition-opacity">🖼️</a>
                          ) : (
                            <span className="text-kb-text-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {r.proof_pix_url ? (
                            <a href={r.proof_pix_url} target="_blank" rel="noopener noreferrer" title="Comprobante PIX" className="text-base hover:opacity-70 transition-opacity">🖼️</a>
                          ) : (
                            <span className="text-kb-text-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {confirmandoEliminarId === r.id ? (
                            <span className="inline-flex items-center gap-1.5">
                              <button
                                onClick={() => { setConfirmandoEliminarId(null); eliminar(r.id); }}
                                className="text-xs font-semibold text-kb-loss hover:brightness-110 transition-colors"
                              >
                                Sí, eliminar
                              </button>
                              <span className="text-kb-text-muted">·</span>
                              <button
                                onClick={() => setConfirmandoEliminarId(null)}
                                className="text-xs text-kb-text-muted hover:text-kb-text transition-colors"
                              >
                                Cancelar
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => setConfirmandoEliminarId(r.id)}
                              className="text-xs text-kb-text-muted hover:text-kb-loss transition-colors"
                            >
                              Eliminar
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {retiros.length > 1 && (
                  <tfoot>
                    <tr className="border-t border-kb-border bg-kb-bg/60 text-xs font-semibold">
                      <td colSpan={2} className="px-4 py-3 text-kb-text-secondary">Total</td>
                      <td className="px-4 py-3 text-right font-mono text-kb-text">{formatCurrency(totales.bruto)}</td>
                      <td className="px-4 py-3 text-right font-mono text-kb-loss">
                        {totales.feeTotal > 0 ? `-${formatCurrency(totales.feeTotal)}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-kb-gain">{formatCurrency(totales.neto)}</td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3 text-right font-mono text-kb-accent">
                        {totales.brl > 0 ? `R$ ${totales.brl.toFixed(2)}` : "—"}
                      </td>
                      <td colSpan={5}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// =====================================================================
// VISTA: APORTES — pagos de challenges, reintentos y cuentas nuevas.
// Permite calcular el ROI real vs purchase_cost estimado.
// =====================================================================

function InversionesView({
  cuentas,
  cuentaActivaId,
  aportes,
  cargando,
  onCambio,
}: {
  cuentas: Account[];
  cuentaActivaId: CuentaSeleccion;
  aportes: Investment[];
  cargando: boolean;
  onCambio: () => void;
}) {
  const cuentaParaAporte = cuentaActivaId === "todas" ? "" : cuentaActivaId;
  const [accountId, setAccountId] = useState(cuentaParaAporte || cuentas[0]?.id || "");
  const [amountStr, setAmountStr] = useState("");
  const [tipo, setTipo] = useState<InvestmentType>("fase_1");
  const [fecha, setFecha] = useState(() => todayKey());
  const [notes, setNotes] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exitoAporte, setExitoAporte] = useState(false);
  const exitoAporteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (exitoAporteTimerRef.current) clearTimeout(exitoAporteTimerRef.current); }, []);
  const [confirmandoEliminarId, setConfirmandoEliminarId] = useState<string | null>(null);

  // Aportes filtrados según la cuenta activa
  const aportesVisibles = useMemo(() => {
    if (cuentaActivaId === "todas") return aportes;
    return aportes.filter((a) => a.account_id === cuentaActivaId);
  }, [aportes, cuentaActivaId]);

  const totalAportado = useMemo(
    () => aportesVisibles.reduce((acc, a) => acc + a.amount, 0),
    [aportesVisibles]
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const monto = parseFloat(amountStr);
    if (!accountId || Number.isNaN(monto) || monto <= 0) {
      setError("Seleccioná una cuenta e ingresá un monto válido.");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setError("Tu sesión expiró. Volvé a iniciar sesión.");
      return;
    }

    setEnviando(true);
    const { error: insertError } = await conReintento(() =>
      supabase.from("investments").insert({
        user_id: userId,
        account_id: accountId,
        amount: monto,
        investment_date: fecha,
        investment_type: tipo,
        notes: notes.trim() === "" ? null : notes.trim(),
      })
    );
    setEnviando(false);

    if (insertError) {
      setError(`No se pudo registrar el aporte. Detalle: ${insertError.message}`);
      return;
    }

    setAmountStr("");
    setNotes("");
    setExitoAporte(true);
    if (exitoAporteTimerRef.current) clearTimeout(exitoAporteTimerRef.current);
    exitoAporteTimerRef.current = setTimeout(() => setExitoAporte(false), 4000);
    onCambio();
  }

  async function eliminar(id: string) {
    const { error: deleteError } = await supabase.from("investments").delete().eq("id", id);
    if (deleteError) {
      setError("No se pudo eliminar el aporte. Intenta de nuevo.");
      return;
    }
    onCambio();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-bold text-kb-text">Aportes</h1>
        <p className="mt-0.5 text-sm text-kb-text-secondary">
          {aportesVisibles.length === 0
            ? "Registrá los fees que pagaste por tus challenges para calcular tu ROI real."
            : `${aportesVisibles.length} aporte${aportesVisibles.length === 1 ? "" : "s"} · ${formatCurrency(totalAportado)} invertido en total`}
        </p>
      </div>

      <div className="rounded-xl border border-kb-accent/30 bg-kb-accent/5 px-4 py-3 text-xs text-kb-text-secondary">
        <p>
          <span className="font-semibold text-kb-text">¿Para qué sirve esto?</span>{" "}
          Cada fee que pagaste por un challenge va acá. La sección{" "}
          <span className="font-medium text-kb-text">Rentabilidad</span> usa esta suma como
          "Invertido real" en vez de un número estimado, así el ROI que ves refleja lo que
          realmente costó operar cada cuenta.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        {/* ── formulario ─────────────────────────────────────── */}
        <section className="h-fit rounded-xl border border-kb-border bg-kb-surface p-5">
          <h2 className="font-display text-base font-semibold mb-1">Registrar aporte</h2>
          <p className="mb-4 text-xs text-kb-text-secondary">
            Cualquier monto que hayas pagado para operar esta cuenta.
          </p>

          {cuentas.length === 0 ? (
            <p className="rounded-lg border border-kb-accent/30 bg-kb-accent/10 px-3 py-2 text-xs text-kb-accent">
              Crea una cuenta primero para poder registrar aportes.
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

              <Campo etiqueta="Tipo de aporte">
                <select
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as InvestmentType)}
                  className={inputClass}
                >
                  {(Object.entries(INVESTMENT_TYPE_LABELS) as [InvestmentType, string][]).map(
                    ([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    )
                  )}
                </select>
              </Campo>

              <Campo etiqueta="Monto (USD)">
                <input
                  required
                  type="number"
                  step="any"
                  min="0.01"
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  placeholder="Ej. 160"
                  className={inputClass}
                />
              </Campo>

              <Campo etiqueta="Fecha de pago">
                <input
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  className={inputClass}
                />
              </Campo>

              <Campo etiqueta="Notas (opcional)">
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ej. Primer intento LucidFlex 50K"
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
                className="w-full rounded-lg bg-kb-accent/80 py-2.5 text-sm font-semibold text-white hover:bg-kb-accent transition disabled:opacity-60"
              >
                {enviando ? "Guardando…" : "Registrar aporte"}
              </button>

              {exitoAporte && (
                <p className="mt-2 rounded-lg border border-kb-gain/30 bg-kb-gain/10 px-3 py-2 text-center text-xs font-semibold text-kb-gain">
                  ✓ Aporte registrado correctamente
                </p>
              )}
            </form>
          )}
        </section>

        {/* ── historial ──────────────────────────────────────── */}
        <section className="overflow-hidden rounded-xl border border-kb-border bg-kb-surface">
          <div className="flex items-center justify-between border-b border-kb-border-soft px-5 py-4">
            <h2 className="font-display text-base font-semibold">Historial</h2>
            {aportesVisibles.length > 0 && (
              <span className="rounded-full bg-kb-accent/10 px-3 py-1 text-xs font-semibold text-kb-accent">
                Total invertido {formatCurrency(totalAportado)}
              </span>
            )}
          </div>

          {cargando ? (
            <SkeletonFilas filas={4} />
          ) : aportesVisibles.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-kb-text-secondary">
              Todavía no registraste ningún aporte.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-kb-border-soft text-xs text-kb-text-secondary">
                    <th className="px-5 py-3 font-medium">Fecha</th>
                    <th className="px-5 py-3 font-medium">Cuenta</th>
                    <th className="px-5 py-3 font-medium">Tipo</th>
                    <th className="px-5 py-3 font-medium">Notas</th>
                    <th className="px-5 py-3 font-medium text-right">Monto</th>
                    <th className="px-5 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {aportesVisibles.map((a) => {
                    const cuentaDelAporte = cuentas.find((c) => c.id === a.account_id);
                    return (
                      <tr
                        key={a.id}
                        className="border-b border-kb-border-soft last:border-0 hover:bg-kb-bg/40 transition-colors"
                      >
                        <td className="px-5 py-3 text-kb-text-secondary whitespace-nowrap">
                          {formatDateOnly(a.investment_date)}
                        </td>
                        <td className="px-5 py-3 font-medium text-kb-text">
                          {cuentaDelAporte?.name ?? "Cuenta eliminada"}
                        </td>
                        <td className="px-5 py-3">
                          <span className="rounded-full bg-kb-accent/10 px-2 py-0.5 text-xs font-medium text-kb-accent">
                            {INVESTMENT_TYPE_LABELS[a.investment_type]}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-kb-text-muted">{a.notes ?? "—"}</td>
                        <td className="px-5 py-3 text-right font-mono font-semibold text-kb-loss">
                          -{formatCurrency(a.amount)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {confirmandoEliminarId === a.id ? (
                            <span className="inline-flex items-center gap-1.5">
                              <button
                                onClick={() => { setConfirmandoEliminarId(null); eliminar(a.id); }}
                                className="text-xs font-semibold text-kb-loss hover:brightness-110 transition-colors"
                              >
                                Sí, eliminar
                              </button>
                              <span className="text-kb-text-muted">·</span>
                              <button
                                onClick={() => setConfirmandoEliminarId(null)}
                                className="text-xs text-kb-text-muted hover:text-kb-text transition-colors"
                              >
                                Cancelar
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => setConfirmandoEliminarId(a.id)}
                              className="text-xs text-kb-text-muted hover:text-kb-loss transition-colors"
                            >
                              Eliminar
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {aportesVisibles.length > 1 && (
                  <tfoot>
                    <tr className="border-t border-kb-border bg-kb-bg/60 text-xs font-semibold">
                      <td colSpan={4} className="px-5 py-3 text-kb-text-secondary">Total invertido</td>
                      <td className="px-5 py-3 text-right font-mono text-kb-loss">
                        -{formatCurrency(totalAportado)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
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
  const [exitoLogro, setExitoLogro] = useState(false);
  const exitoLogroTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (exitoLogroTimerRef.current) clearTimeout(exitoLogroTimerRef.current); }, []);

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
    setExitoLogro(true);
    if (exitoLogroTimerRef.current) clearTimeout(exitoLogroTimerRef.current);
    exitoLogroTimerRef.current = setTimeout(() => setExitoLogro(false), 4000);
    onCambio();
  }

  async function eliminar(logro: Achievement) {
    // Borramos primero el archivo del bucket (si tenía uno adjunto), para
    // no dejar certificados huérfanos ocupando espacio de Storage.
    if (logro.file_url) {
      const ruta = extraerRutaStorage("achievements", logro.file_url);
      await supabase.storage.from("achievements").remove([ruta]);
    }
    const { error: deleteError } = await supabase.from("achievements").delete().eq("id", logro.id);
    if (deleteError) {
      setError("No se pudo eliminar el logro. Intenta de nuevo.");
      return;
    }
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

            {exitoLogro && (
              <p className="mt-2 rounded-lg border border-kb-gain/30 bg-kb-gain/10 px-3 py-2 text-center text-xs font-semibold text-kb-gain">
                ✓ Logro guardado correctamente
              </p>
            )}
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
  const [confirmando, setConfirmando] = useState(false);

  useEffect(() => {
    let activo = true;
    async function resolver() {
      if (!logro.file_url) return;
      const ruta = extraerRutaStorage("achievements", logro.file_url);
      const { data, error } = await supabase.storage.from("achievements").createSignedUrl(ruta, 3600);
      if (activo) setUrlFirmada(error ? null : (data?.signedUrl ?? null));
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
        {confirmando ? (
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => { setConfirmando(false); onEliminar(); }}
              className="text-[11px] font-semibold text-kb-loss hover:brightness-110 transition-colors"
            >
              Sí, eliminar
            </button>
            <span className="text-[11px] text-kb-text-muted">·</span>
            <button
              onClick={() => setConfirmando(false)}
              className="text-[11px] text-kb-text-muted hover:text-kb-text transition-colors"
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmando(true)}
            className="mt-2 text-[11px] text-kb-text-muted hover:text-kb-loss transition-colors"
          >
            Eliminar
          </button>
        )}
      </div>
    </div>
  );
}

function PerfilView({
  session,
  onNombreActualizado,
}: {
  session: Session;
  onNombreActualizado?: (nombre: string) => void;
}) {
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

  // ---- Perfil público (solo lectura, compartible por link) ----
  const [publicEnabled, setPublicEnabled] = useState(false);
  const [publicToken, setPublicToken] = useState<string | null>(null);
  const [guardandoPublico, setGuardandoPublico] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [errorPublico, setErrorPublico] = useState<string | null>(null);
  const [confirmandoRegenerar, setConfirmandoRegenerar] = useState(false);

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
      setPublicEnabled(p?.public_enabled ?? false);
      setPublicToken(p?.public_token ?? null);
      setCargandoPerfil(false);
    }
    cargarPerfil();
  }, [session.user.id]);

  async function alternarPerfilPublico(activar: boolean) {
    setGuardandoPublico(true);
    setErrorPublico(null);
    // Si todavía no tiene token (primera vez que activa), generamos uno.
    let token = publicToken;
    if (activar && !token) {
      token = crypto.randomUUID();
    }
    const { error: updateError } = await supabase
      .from("profiles")
      .upsert({ id: session.user.id, public_enabled: activar, public_token: token });
    setGuardandoPublico(false);
    if (!updateError) {
      setPublicEnabled(activar);
      setPublicToken(token);
    } else {
      setErrorPublico(
        `No se pudo guardar (${updateError.message}). Si nunca corriste el SQL de "public_enabled"/"public_token" en Supabase, es por eso.`
      );
    }
  }

  async function regenerarLink() {
    setConfirmandoRegenerar(false);
    setGuardandoPublico(true);
    const nuevoToken = crypto.randomUUID();
    const { error: updateError } = await supabase
      .from("profiles")
      .upsert({ id: session.user.id, public_enabled: publicEnabled, public_token: nuevoToken });
    setGuardandoPublico(false);
    if (!updateError) setPublicToken(nuevoToken);
  }

  function copiarLink() {
    if (!publicToken) return;
    const url = `${window.location.origin}/p/${publicToken}`;
    navigator.clipboard.writeText(url);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

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
    if (displayName.trim() !== "") onNombreActualizado?.(displayName.trim());
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
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold">🔗 Página pública</h2>
            <p className="mt-0.5 text-sm text-kb-text-secondary">
              Compartí un resumen de solo lectura de tu rendimiento, sin login y sin que
              nadie pueda editar nada. Separado de tu perfil privado.
            </p>
          </div>
          <button
            type="button"
            onClick={() => alternarPerfilPublico(!publicEnabled)}
            disabled={guardandoPublico || cargandoPerfil}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
              publicEnabled ? "bg-kb-gain" : "bg-kb-border"
            }`}
            aria-label="Activar o desactivar página pública"
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                publicEnabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        {errorPublico && (
          <p className="mt-3 rounded-lg border border-kb-loss/30 bg-kb-loss/10 px-3 py-2 text-xs text-kb-loss">
            {errorPublico}
          </p>
        )}

        {publicEnabled && publicToken && (
          <div className="mt-4 rounded-lg border border-kb-gain/30 bg-kb-gain/5 p-3">
            <p className="mb-2 text-xs font-medium text-kb-gain">✅ Tu página pública está activa</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="flex-1 min-w-0 truncate rounded-lg border border-kb-border-soft bg-kb-bg px-3 py-2 text-xs text-kb-text-secondary">
                {typeof window !== "undefined" ? window.location.origin : ""}/p/{publicToken}
              </code>
              <button
                onClick={copiarLink}
                className="shrink-0 rounded-lg border border-kb-border px-3 py-2 text-xs font-medium text-kb-text-secondary hover:border-kb-accent hover:text-kb-accent transition-colors"
              >
                {copiado ? "✓ Copiado" : "Copiar link"}
              </button>
              <a
                href={`/p/${publicToken}`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded-lg border border-kb-border px-3 py-2 text-xs font-medium text-kb-text-secondary hover:border-kb-accent hover:text-kb-accent transition-colors"
              >
                Ver página →
              </a>
            </div>
            {confirmandoRegenerar ? (
              <div className="mt-2 flex items-center gap-2 text-[11px]">
                <span className="text-kb-text-muted">¿Confirmar? El link anterior deja de funcionar.</span>
                <button onClick={regenerarLink} disabled={guardandoPublico} className="font-semibold text-kb-loss hover:underline">
                  Sí, regenerar
                </button>
                <button onClick={() => setConfirmandoRegenerar(false)} className="text-kb-text-muted hover:text-kb-text transition-colors">
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmandoRegenerar(true)}
                disabled={guardandoPublico}
                className="mt-2 text-[11px] text-kb-text-muted hover:text-kb-loss transition-colors"
              >
                Regenerar link (invalida el actual)
              </button>
            )}
          </div>
        )}
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
  | "instrument_type"
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
  { campo: "instrument_type", etiqueta: "Tipo de instrumento", requerido: false },
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

interface TradeOcr {
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

function ImportarView({
  cuentas,
  estrategias,
  cuentaActivaId,
  onImportado,
}: {
  cuentas: Account[];
  estrategias: Strategy[];
  cuentaActivaId: CuentaSeleccion;
  onImportado: () => void;
}) {
  const [paso, setPaso] = useState<"subir" | "mapear" | "revisar" | "listo">("subir");
  const [nombreArchivo, setNombreArchivo] = useState("");
  const [encabezados, setEncabezados] = useState<string[]>([]);
  const [filasDatos, setFilasDatos] = useState<string[][]>([]);
  const [mapeo, setMapeo] = useState<Partial<Record<CampoDestino, number>>>({});
  // Arranca ya con la cuenta que tenías activa en el sidebar, así no
  // hay que elegirla dos veces — se puede cambiar igual si hace falta.
  const [accountId, setAccountId] = useState(cuentaActivaId !== "todas" ? cuentaActivaId : "");
  const [strategyId, setStrategyId] = useState("");
  const [sideDefault, setSideDefault] = useState<TradeSide>("long");
  const [instrumentTypeImport, setInstrumentTypeImport] = useState<InstrumentType>("forex");
  // Muchos reportes de plataformas de futuros (como el "Position History"
  // de Tradovate) no incluyen la comisión en el archivo — viene en un
  // reporte aparte. En vez de pedir un segundo archivo, dejamos que el
  // usuario cargue el costo por contrato UNA sola vez acá, y la app lo
  // multiplica sola por la cantidad de cada operación al importar.
  const [comisionPorContrato, setComisionPorContrato] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<{ insertados: number; saltados: number } | null>(null);
  const [mostrarGuia, setMostrarGuia] = useState(true);

  // ─── Estado para modo OCR ──────────────────────────────────────────
  const [modoImportar, setModoImportar] = useState<"csv" | "ocr" | "mt">("csv");
  const [imagenOcrData, setImagenOcrData] = useState<string | null>(null);
  const [imagenOcrMime, setImagenOcrMime] = useState<string>("image/png");
  const [imagenOcrPreview, setImagenOcrPreview] = useState<string | null>(null);
  const [procesandoOcr, setProcesandoOcr] = useState(false);
  const [tradesOcr, setTradesOcr] = useState<TradeOcr[]>([]);
  const [errorOcr, setErrorOcr] = useState<string | null>(null);
  const [guardandoOcr, setGuardandoOcr] = useState(false);
  const [resultadoOcr, setResultadoOcr] = useState<{ insertados: number } | null>(null);
  const [confirmandoGuardarOcr, setConfirmandoGuardarOcr] = useState(false);
  const [accountIdOcr, setAccountIdOcr] = useState(cuentaActivaId !== "todas" ? cuentaActivaId : "");
  const [strategyIdOcr, setStrategyIdOcr] = useState("");

  // ─── Estado para modo MetaTrader HTML ─────────────────────────────
  type TradesMT = {
    symbol: string;
    side: TradeSide;
    quantity: number;
    entry_price: number;
    exit_price: number | null;
    entry_time: string;
    exit_time: string | null;
    realized_pnl: number | null;
    fees: number;
  };
  const [tradesMt, setTradesMt] = useState<TradesMT[]>([]);
  const [errorMt, setErrorMt] = useState<string | null>(null);
  const [guardandoMt, setGuardandoMt] = useState(false);
  const [resultadoMt, setResultadoMt] = useState<{ insertados: number } | null>(null);
  const [accountIdMt, setAccountIdMt] = useState(cuentaActivaId !== "todas" ? cuentaActivaId : "");
  const [strategyIdMt, setStrategyIdMt] = useState("");

  function reiniciarOcr() {
    setImagenOcrData(null);
    setImagenOcrMime("image/png");
    setImagenOcrPreview(null);
    setTradesOcr([]);
    setErrorOcr(null);
    setResultadoOcr(null);
    setConfirmandoGuardarOcr(false); // BUG-2: evitar que la confirmación quede abierta al cambiar imagen
  }

  // ─── Helpers MetaTrader HTML ──────────────────────────────────────
  function reiniciarMt() {
    setTradesMt([]);
    setErrorMt(null);
    setResultadoMt(null);
  }

  function parsearHtmlMt(html: string) {
    setErrorMt(null);
    setTradesMt([]);
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const filas = Array.from(doc.querySelectorAll("tr")).filter((tr) => {
        const celdas = Array.from(tr.querySelectorAll("td"));
        return celdas.length >= 8;
      });

      if (filas.length === 0) {
        setErrorMt("No se encontraron operaciones en el HTML. Asegurate de subir el reporte de historial de MetaTrader 4 o 5 (.htm/.html).");
        return;
      }

      const trades: TradesMT[] = [];
      for (const fila of filas) {
        const cols = Array.from(fila.querySelectorAll("td")).map((td) => td.textContent?.trim() ?? "");

        // MT4: col[2] es el tipo (buy/sell)
        // MT5: col[3] es el tipo (buy/sell)
        // Detectamos por la cantidad de columnas y por el contenido
        const tipoMt4 = cols[2]?.toLowerCase() ?? "";
        const tipoMt5 = cols[3]?.toLowerCase() ?? "";
        const esMt5 = cols.length >= 14;
        const tipoTrade = esMt5 ? tipoMt5 : tipoMt4;

        if (!tipoTrade.includes("buy") && !tipoTrade.includes("sell")) continue;

        const side: TradeSide = tipoTrade.includes("sell") ? "short" : "long";

        // MT4 layout: [ticket, open_time, type, size, symbol, open_price, sl, tp, close_time, close_price, commission, swap, profit]
        // MT5 tiene dos formatos comunes de 14+ columnas:
        //   Formato A: [Position, Time, Deal, Type, Direction, Volume, Price, S/L, T/P, Commission, Swap, Profit, Balance, Comment]
        //   Formato B: [Time, Deal, Symbol, Type, Direction, Volume, Price, Order, Commission, Swap, Profit, Balance, Comment, ...]
        // En ambos casos cols[3] = Type. Se detecta el formato por si cols[0] parece una fecha.
        let symbol: string, quantity: number, entry_price: number, exit_price: number | null,
            entry_time: string, exit_time: string | null, realized_pnl: number | null, fees: number;

        if (esMt5) {
          // Si cols[0] empieza con dígitos de año (ej "2024.") → Formato B (Time primero)
          const col0EsFecha = /^\d{4}[.\-]/.test(cols[0] || "");
          if (col0EsFecha) {
            // Formato B: symbol disponible en cols[2]
            symbol = (cols[2] || "UNKNOWN").toUpperCase();
            quantity = parseFloat(cols[5]) || 0;
            entry_price = parseFloat(cols[6]) || 0;
            exit_price = null;
            entry_time = cols[0] || "";
            exit_time = null;
            realized_pnl = parseFloat(cols[10]) || null;
            fees = parseFloat(cols[8]) || 0;
          } else {
            // Formato A: cols[0] es Position ID, no hay columna de símbolo
            symbol = "UNKNOWN";
            quantity = parseFloat(cols[5]) || 0;
            entry_price = parseFloat(cols[6]) || 0;
            exit_price = null;
            entry_time = cols[1] || "";
            exit_time = null;
            realized_pnl = parseFloat(cols[11]) || null;
            fees = parseFloat(cols[9]) || 0;
          }
        } else {
          // MT4 estándar
          symbol = (cols[4] || "UNKNOWN").toUpperCase();
          quantity = parseFloat(cols[3]) || 0;
          entry_price = parseFloat(cols[5]) || 0;
          exit_price = parseFloat(cols[9]) || null;
          entry_time = cols[1] || "";
          exit_time = cols[8] || null;
          realized_pnl = parseFloat(cols[12]) || null;
          fees = (parseFloat(cols[10]) || 0) + (parseFloat(cols[11]) || 0);
        }

        // Convertir fecha MT "YYYY.MM.DD HH:MM:SS" → ISO con sufijo -03:00
        // (broker MT4/MT5 suele reportar en UTC-3; sin sufijo Supabase
        // interpreta como UTC y desplaza todas las horas incorrectamente)
        const toIso = (s: string): string | null => {
          if (!s) return null;
          const limpio = s.replace(/\./g, "-").replace(" ", "T");
          if (!limpio) return null;
          return limpio.includes("+") || limpio.includes("Z") || /[+-]\d{2}:\d{2}$/.test(limpio)
            ? limpio
            : `${limpio}-03:00`;
        };

        const entryIso = toIso(entry_time);
        if (!entryIso || !symbol || quantity === 0) continue;

        trades.push({
          symbol,
          side,
          quantity,
          entry_price,
          exit_price,
          entry_time: entryIso,
          exit_time: toIso(exit_time ?? ""),
          realized_pnl: isNaN(realized_pnl as number) ? null : realized_pnl,
          fees: isNaN(fees) ? 0 : Math.abs(fees),
        });
      }

      if (trades.length === 0) {
        setErrorMt("Se leyó el archivo pero no se encontraron filas de operaciones reconocibles. Verificá que sea un reporte de historial de MT4 o MT5.");
        return;
      }
      setTradesMt(trades);
    } catch (e) {
      setErrorMt(`Error al procesar el archivo HTML: ${e instanceof Error ? e.message : "Error desconocido"}`);
    }
  }

  async function guardarTradesMt() {
    if (!accountIdMt) {
      setErrorMt("Elegí a qué cuenta se van a guardar estas operaciones.");
      return;
    }
    setGuardandoMt(true);
    setErrorMt(null);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setGuardandoMt(false);
      setErrorMt("Tu sesión expiró. Volvé a iniciar sesión.");
      return;
    }
    const filas = tradesMt.map((t) => ({
      user_id: userId,
      account_id: accountIdMt,
      strategy_id: strategyIdMt === "" ? null : strategyIdMt,
      symbol: t.symbol.toUpperCase(),
      instrument_type: "forex" as InstrumentType,
      side: t.side,
      status: t.exit_price !== null || t.realized_pnl !== null ? "closed" : "open",
      quantity: t.quantity,
      entry_price: t.entry_price,
      exit_price: t.exit_price,
      fees: t.fees,
      realized_pnl: t.realized_pnl,
      result_type: t.exit_price !== null || t.realized_pnl !== null ? "manual" : null,
      notes: null,
      entry_time: t.entry_time,
      exit_time: t.exit_time,
      tradingview_links: [],
      evidence_images: [],
      mistake: "ninguno",
    }));
    let insertados = 0;
    for (let i = 0; i < filas.length; i += 200) {
      const tanda = filas.slice(i, i + 200);
      const { error: err } = await supabase.from("trades").insert(tanda);
      if (err) {
        setGuardandoMt(false);
        setErrorMt(`Error al insertar: ${err.message}`);
        return;
      }
      insertados += tanda.length;
    }
    setGuardandoMt(false);
    setResultadoMt({ insertados });
    onImportado();
  }

  function manejarImagenOcr(archivo: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      // result es "data:image/png;base64,iVBOR..."
      const comma = result.indexOf(",");
      const base64 = result.slice(comma + 1);
      setImagenOcrData(base64);
      setImagenOcrMime(archivo.type || "image/png");
      setImagenOcrPreview(result);
      setTradesOcr([]);
      setErrorOcr(null);
      setResultadoOcr(null);
    };
    reader.readAsDataURL(archivo);
  }

  async function extraerConOCR() {
    if (!imagenOcrData) return;
    setProcesandoOcr(true);
    setErrorOcr(null);
    setTradesOcr([]);
    try {
      const res = await fetch("/api/ocr-trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: imagenOcrData, mimeType: imagenOcrMime }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorOcr(data.error ?? "Error inesperado al procesar la imagen.");
      } else {
        const trades = (data.trades ?? []) as TradeOcr[];
        setTradesOcr(trades);
        if (trades.length === 0) {
          setErrorOcr("No se encontraron operaciones en la imagen. Intentá con una captura más clara de la tabla de trades.");
        }
      }
    } catch {
      setErrorOcr("No se pudo conectar con el servidor. Verificá tu conexión a internet.");
    } finally {
      setProcesandoOcr(false);
    }
  }

  async function guardarTradesOcr() {
    if (!accountIdOcr) {
      setErrorOcr("Elegí a qué cuenta se van a guardar estas operaciones.");
      return;
    }
    setGuardandoOcr(true);
    setErrorOcr(null);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setGuardandoOcr(false);
      setErrorOcr("Tu sesión expiró. Volvé a iniciar sesión.");
      return;
    }

    // Agrega el offset de Brasil (-03:00) si el string no tiene timezone
    const addBrTz = (dt: string | null): string | null => {
      if (!dt) return null;
      if (dt.includes("Z") || dt.includes("+") || dt.length > 19) return dt;
      return dt + "-03:00";
    };

    // Borrar trades existentes para las mismas fechas + cuenta antes de insertar
    const fechasUnicas = [...new Set(
      tradesOcr
        .filter((t) => t.entry_time)
        .map((t) => t.entry_time!.substring(0, 10))
    )];
    for (const fecha of fechasUnicas) {
      const { error: deleteError } = await supabase
        .from("trades")
        .delete()
        .eq("account_id", accountIdOcr)
        .eq("user_id", userId)
        .gte("entry_time", `${fecha}T00:00:00-03:00`)
        .lte("entry_time", `${fecha}T23:59:59-03:00`);

      if (deleteError) {
        setGuardandoOcr(false);
        setErrorOcr(`No se pudo limpiar los trades del ${fecha} antes de importar. Operación cancelada para evitar duplicados. Intentá de nuevo.`);
        return;
      }
    }

    const filasParaInsertar: Record<string, unknown>[] = tradesOcr.map((t) => ({
      user_id: userId,
      account_id: accountIdOcr,
      strategy_id: strategyIdOcr === "" ? null : strategyIdOcr,
      symbol: t.symbol.toUpperCase(),
      instrument_type: "futures",
      side: t.side,
      status: t.exit_price !== null || t.realized_pnl !== null ? "closed" : "open",
      quantity: t.quantity,
      entry_price: t.entry_price,
      exit_price: t.exit_price,
      fees: t.fees,
      // El NET PNL de Lucid ya viene con fees descontados — NO restar fees de nuevo
      realized_pnl:
        t.exit_price !== null || t.realized_pnl !== null
          ? (t.realized_pnl ?? 0)
          : null,
      result_type: t.exit_price !== null || t.realized_pnl !== null ? "manual" : null,
      notes: null,
      entry_time: addBrTz(t.entry_time),
      exit_time: addBrTz(t.exit_time),
      tradingview_links: [],
      evidence_images: [],
      mistake: "ninguno",
    }));
    let insertados = 0;
    for (let i = 0; i < filasParaInsertar.length; i += 200) {
      const tanda = filasParaInsertar.slice(i, i + 200);
      const { error: err } = await supabase.from("trades").insert(tanda);
      if (err) {
        setGuardandoOcr(false);
        setErrorOcr(`Error al insertar trades (tanda ${i / 200 + 1}): ${err.message}. Se importaron ${insertados} antes del error.`);
        return;
      }
      insertados += tanda.length;
    }
    setGuardandoOcr(false);
    setResultadoOcr({ insertados });
    onImportado();
  }

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

      // Auto-mapeo: si alguna columna se llama parecido a lo que
      // buscamos, la pre-seleccionamos (el usuario puede corregirla).
      // Incluye nombres típicos de MT4/5, prop firms, y plataformas de
      // futuros (Tradovate, NinjaTrader, Rithmic) como Contract, B/S,
      // Avg Fill Price, Timestamp, etc.
      const autoMapeo: Partial<Record<CampoDestino, number>> = {};
      const alias: Record<CampoDestino, string[]> = {
        symbol: ["symbol", "simbolo", "símbolo", "ticker", "activo", "contract", "product"],
        instrument_type: ["instrument type", "tipo instrumento", "asset type", "tipo activo"],
        side: ["side", "direction", "direccion", "b/s", "buy/sell", "buysell", "action"],
        quantity: [
          "quantity", "cantidad", "lots", "lotes", "volume", "volumen", "qty",
          "filled qty", "paired qty", "contracts",
        ],
        entry_price: [
          "entry price", "open price", "precio entrada", "precio apertura", "openprice",
          "avg fill price", "fill price", "avgfillprice", "buy price", "bought price",
          "buyprice", "avg buy price",
        ],
        exit_price: [
          "exit price", "close price", "precio salida", "precio cierre", "closeprice",
          "sell price", "sold price", "sellprice", "avg sell price", "exit avg fill price",
        ],
        entry_time: [
          // OJO: "timestamp" a secas NO va acá — varios reportes (como el
          // de Tradovate) tienen una columna genérica "Timestamp" antes
          // de la específica "Bought Timestamp", y si "timestamp" fuera
          // alias, la genérica ganaba por aparecer primero en el archivo.
          "entry time", "open time", "fecha entrada", "fecha apertura", "opentime",
          "fill time", "filltime", "execution time", "order time",
          "buy time", "bought timestamp", "buy timestamp",
        ],
        exit_time: [
          "exit time", "close time", "fecha salida", "fecha cierre", "closetime",
          "sell time", "sold timestamp", "sell timestamp",
        ],
        realized_pnl: [
          // Aliases más específicos primero para evitar falsos positivos
          // con columnas genéricas "Profit" en Tradovate (que es gross, no net).
          "net profit", "net p/l", "net pnl", "realized p/l", "realized pnl",
          "gain/loss", "closed pnl", "total p/l", "ganancia neta",
          "pnl", "p&l", "p/l", "ganancia", "resultado", "realized",
        ],
        fees: ["commission", "comision", "comisión", "fee", "fees", "swap"],
        notes: ["comment", "comentario", "notes", "notas", "text"],
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
      // Tipo de instrumento: del CSV si viene mapeado, si no el default elegido.
      const tipoDelCSV = obtener("instrument_type")?.trim().toLowerCase();
      const TIPOS_VALIDOS: InstrumentType[] = ["stock", "option", "crypto", "forex", "futures"];
      const instrumentTypeRow: InstrumentType =
        tipoDelCSV && TIPOS_VALIDOS.includes(tipoDelCSV as InstrumentType)
          ? (tipoDelCSV as InstrumentType)
          : instrumentTypeImport;

      if (!symbol || quantity === null || entryPrice === null || !entryTime) {
        saltados++;
        continue;
      }

      const exitPrice = parsearNumeroCSV(obtener("exit_price"));
      const exitTime = parsearFechaCSV(obtener("exit_time"));
      const realizedPnl = parsearNumeroCSV(obtener("realized_pnl"));
      // Si el archivo trae su propia columna de comisión, la usamos. Si
      // no, y el usuario cargó un costo por contrato, la calculamos
      // sola (cantidad × comisión por contrato) — así solo hace falta
      // un archivo, sin tener que exportar ni subir un segundo reporte.
      const feesDelArchivo = parsearNumeroCSV(obtener("fees"));
      const comisionPorContratoNum = parseFloat(comisionPorContrato);
      const fees =
        feesDelArchivo ??
        (!Number.isNaN(comisionPorContratoNum) ? Math.abs(quantity) * comisionPorContratoNum : 0);
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
        instrument_type: instrumentTypeRow,
        side,
        status: estaCerrado ? "closed" : "open",
        quantity,
        entry_price: entryPrice,
        exit_price: exitPrice,
        fees,
        // Si el CSV trae su propio P&L, lo usamos tal cual (la mayoría
        // de brokers y exportaciones ya dan el P&L neto, con fees
        // incluidas). Solo restamos fees cuando calculamos el P&L nosotros.
        realized_pnl: realizedPnl !== null ? realizedPnl : null,
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
    let errorInsert: string | null = null;
    for (let i = 0; i < filasParaInsertar.length; i += 200) {
      const tanda = filasParaInsertar.slice(i, i + 200);
      const { error: insertError } = await supabase.from("trades").insert(tanda);
      if (!insertError) {
        insertados += tanda.length;
      } else {
        saltados += tanda.length;
        errorInsert = insertError.message;
        break; // detener en error fatal para evitar datos parciales inconsistentes
      }
    }
    if (errorInsert) {
      setImportando(false);
      setError(`Error al importar: ${errorInsert}. Se insertaron ${insertados} trade(s) antes del fallo.`);
      return;
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

      {/* ─── Selector de modo: CSV / OCR / MetaTrader HTML ────────── */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setModoImportar("csv")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
            modoImportar === "csv"
              ? "bg-kb-accent text-kb-bg"
              : "border border-kb-border text-kb-text-secondary hover:text-kb-text"
          }`}
        >
          📄 Importar CSV
        </button>
        <button
          onClick={() => setModoImportar("ocr")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
            modoImportar === "ocr"
              ? "bg-kb-accent text-kb-bg"
              : "border border-kb-border text-kb-text-secondary hover:text-kb-text"
          }`}
        >
          📷 OCR desde captura
        </button>
        <button
          onClick={() => { setModoImportar("mt"); reiniciarMt(); }}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
            modoImportar === "mt"
              ? "bg-kb-accent text-kb-bg"
              : "border border-kb-border text-kb-text-secondary hover:text-kb-text"
          }`}
        >
          🖥️ MetaTrader HTML
        </button>
      </div>

      {/* ─── Modo MetaTrader HTML ─────────────────────────────────── */}
      {modoImportar === "mt" && (
        <section className="space-y-4">
          {resultadoMt ? (
            <div className="rounded-xl border border-kb-gain/30 bg-kb-gain/5 p-8 text-center">
              <p className="text-3xl">✅</p>
              <h2 className="mt-2 font-display text-lg font-semibold text-kb-text">¡Trades importados!</h2>
              <p className="mt-1 text-sm text-kb-text-secondary">
                <span className="font-semibold text-kb-gain">{resultadoMt.insertados}</span> operaciones guardadas.
              </p>
              <button
                onClick={reiniciarMt}
                className="mt-4 rounded-lg border border-kb-border px-5 py-2.5 text-sm font-medium text-kb-text-secondary hover:text-kb-text transition-colors"
              >
                Importar otro archivo
              </button>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-kb-accent/20 bg-kb-accent/5 px-4 py-3 text-xs text-kb-accent">
                <p className="font-semibold">¿Cómo obtener el archivo HTML de MetaTrader?</p>
                <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-kb-text-secondary">
                  <li>Abrí MetaTrader 4 o 5 → pestaña <span className="text-kb-text">Historia de cuenta</span> (Account History).</li>
                  <li>Click derecho sobre la tabla → <span className="text-kb-text">Guardar como reporte</span> (Save as Report) → guardalo como <span className="font-mono text-kb-text">.htm</span> o <span className="font-mono text-kb-text">.html</span>.</li>
                  <li>Subí ese archivo acá abajo.</li>
                </ol>
              </div>

              {tradesMt.length === 0 ? (
                <label className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-kb-accent/40 bg-kb-accent/5 p-8 text-center cursor-pointer hover:bg-kb-accent/10 transition">
                  <span className="text-4xl">🖥️</span>
                  <span className="text-sm font-semibold text-kb-text">Subí el reporte HTML de MetaTrader</span>
                  <span className="text-xs text-kb-text-secondary">Archivos .htm o .html — MT4 y MT5</span>
                  <span className="mt-1 rounded-lg bg-kb-accent px-4 py-2 text-sm font-semibold text-kb-bg">
                    Elegir archivo
                  </span>
                  <input
                    type="file"
                    accept=".htm,.html,text/html"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      const reader = new FileReader();
                      reader.onload = (ev) => parsearHtmlMt(String(ev.target?.result ?? ""));
                      reader.readAsText(f);
                    }}
                  />
                </label>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-kb-text">
                      Se encontraron <span className="text-kb-gain">{tradesMt.length}</span> operaciones
                    </p>
                    <button
                      onClick={reiniciarMt}
                      className="text-xs text-kb-text-muted hover:text-kb-text transition-colors"
                    >
                      Cambiar archivo
                    </button>
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-kb-border-soft">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-kb-border-soft bg-kb-bg text-kb-text-secondary">
                          <th className="px-3 py-2 font-medium">Símbolo</th>
                          <th className="px-3 py-2 font-medium">Dir.</th>
                          <th className="px-3 py-2 font-medium">Qty</th>
                          <th className="px-3 py-2 font-medium">Entrada</th>
                          <th className="px-3 py-2 font-medium">Salida</th>
                          <th className="px-3 py-2 font-medium">P&amp;L</th>
                          <th className="px-3 py-2 font-medium">Fee</th>
                          <th className="px-3 py-2 font-medium">Hora entrada</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tradesMt.slice(0, 50).map((t, i) => (
                          <tr key={i} className="border-b border-kb-border-soft last:border-0">
                            <td className="px-3 py-2 font-mono font-semibold text-kb-text">{t.symbol}</td>
                            <td className="px-3 py-2">
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${t.side === "long" ? "bg-kb-gain/20 text-kb-gain" : "bg-kb-loss/20 text-kb-loss"}`}>
                                {t.side === "long" ? "L" : "S"}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-kb-text">{t.quantity}</td>
                            <td className="px-3 py-2 font-mono text-kb-text">{t.entry_price}</td>
                            <td className="px-3 py-2 font-mono text-kb-text">{t.exit_price ?? "—"}</td>
                            <td className={`px-3 py-2 font-mono font-semibold ${t.realized_pnl === null ? "text-kb-text-secondary" : t.realized_pnl >= 0 ? "text-kb-gain" : "text-kb-loss"}`}>
                              {t.realized_pnl !== null ? `${t.realized_pnl >= 0 ? "+" : ""}${t.realized_pnl.toFixed(2)}` : "—"}
                            </td>
                            <td className="px-3 py-2 font-mono text-kb-text-secondary">{t.fees > 0 ? t.fees.toFixed(2) : "—"}</td>
                            <td className="px-3 py-2 text-kb-text-secondary">{t.entry_time.replace("T", " ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {tradesMt.length > 50 && (
                      <p className="border-t border-kb-border-soft px-4 py-2 text-center text-xs text-kb-text-muted">
                        Mostrando 50 de {tradesMt.length} operaciones. Se van a guardar todas.
                      </p>
                    )}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-kb-text-secondary">Guardar en la cuenta *</label>
                      <select
                        value={accountIdMt}
                        onChange={(e) => setAccountIdMt(e.target.value)}
                        className={inputClass}
                      >
                        <option value="">Elegí una cuenta…</option>
                        {cuentas.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-kb-text-secondary">Estrategia (opcional)</label>
                      <select
                        value={strategyIdMt}
                        onChange={(e) => setStrategyIdMt(e.target.value)}
                        className={inputClass}
                      >
                        <option value="">Sin estrategia</option>
                        {estrategias.map((e) => (
                          <option key={e.id} value={e.id}>{e.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {errorMt && (
                    <p className="rounded-lg border border-kb-loss/30 bg-kb-loss/10 px-3 py-2 text-xs text-kb-loss">
                      {errorMt}
                    </p>
                  )}

                  <button
                    onClick={guardarTradesMt}
                    disabled={guardandoMt || !accountIdMt}
                    className="w-full rounded-xl bg-kb-gain py-3 text-sm font-bold text-kb-bg hover:brightness-110 transition disabled:opacity-60"
                  >
                    {guardandoMt ? "Guardando…" : `Importar ${tradesMt.length} operaciones`}
                  </button>
                </div>
              )}

              {errorMt && tradesMt.length === 0 && (
                <p className="rounded-lg border border-kb-loss/30 bg-kb-loss/10 px-3 py-2 text-xs text-kb-loss">
                  {errorMt}
                </p>
              )}
            </>
          )}
        </section>
      )}

      {/* ─── Modo OCR ──────────────────────────────────────────────── */}
      {modoImportar === "ocr" && (
        <section className="space-y-4">
          {resultadoOcr ? (
            <div className="rounded-xl border border-kb-gain/30 bg-kb-gain/5 p-8 text-center">
              <p className="text-3xl">✅</p>
              <h2 className="mt-2 font-display text-lg font-semibold text-kb-text">¡Trades guardados!</h2>
              <p className="mt-1 text-sm text-kb-text-secondary">
                <span className="font-semibold text-kb-gain">{resultadoOcr.insertados}</span>{" "}
                operaciones guardadas correctamente.
              </p>
              <button
                onClick={reiniciarOcr}
                className="mt-4 rounded-lg border border-kb-border px-5 py-2.5 text-sm font-medium text-kb-text-secondary hover:text-kb-text transition-colors"
              >
                Analizar otra captura
              </button>
            </div>
          ) : (
            <>
              {!imagenOcrPreview ? (
                <label className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-kb-accent/40 bg-kb-accent/5 p-8 text-center cursor-pointer hover:bg-kb-accent/10 transition">
                  <span className="text-4xl">📷</span>
                  <span className="text-sm font-semibold text-kb-text">
                    Subí una captura de tu tabla de trades
                  </span>
                  <span className="text-xs text-kb-text-secondary">
                    PNG, JPG o WebP · Funciona con Tradovate, Lucid, MT4/MT5, NinjaTrader y más
                  </span>
                  <span className="mt-1 rounded-lg bg-kb-accent px-4 py-2 text-sm font-semibold text-kb-bg">
                    Elegir imagen
                  </span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) manejarImagenOcr(f);
                    }}
                  />
                </label>
              ) : (
                <div className="rounded-xl border border-kb-border bg-kb-surface p-5 space-y-5">
                  <div className="flex items-start gap-5">
                    <img
                      src={imagenOcrPreview}
                      alt="Captura a analizar"
                      className="max-h-52 max-w-xs rounded-lg object-contain border border-kb-border-soft shrink-0"
                    />
                    <div className="flex-1 space-y-3">
                      <p className="text-sm font-semibold text-kb-text">Imagen lista para analizar</p>
                      <p className="text-xs text-kb-text-secondary">
                        La IA va a leer la tabla de operaciones de la captura y extraer los datos automáticamente.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={extraerConOCR}
                          disabled={procesandoOcr}
                          className="rounded-lg bg-kb-accent px-4 py-2 text-sm font-semibold text-kb-bg hover:brightness-110 transition disabled:opacity-60"
                        >
                          {procesandoOcr ? "Analizando…" : "✨ Extraer trades con IA"}
                        </button>
                        <button
                          onClick={reiniciarOcr}
                          className="rounded-lg border border-kb-border px-4 py-2 text-sm font-medium text-kb-text-secondary hover:text-kb-text transition-colors"
                        >
                          Cambiar imagen
                        </button>
                      </div>
                    </div>
                  </div>

                  {procesandoOcr && (
                    <div className="rounded-lg border border-kb-accent/20 bg-kb-accent/5 px-4 py-3 text-sm text-kb-accent">
                      🤖 Leyendo la captura… Esto puede tardar unos segundos.
                    </div>
                  )}

                  {errorOcr && (
                    <p className="rounded-lg border border-kb-loss/30 bg-kb-loss/10 px-3 py-2 text-xs text-kb-loss">
                      {errorOcr}
                    </p>
                  )}

                  {tradesOcr.length > 0 && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-kb-text">
                          Se encontraron{" "}
                          <span className="text-kb-gain">{tradesOcr.length}</span>{" "}
                          operaci{tradesOcr.length === 1 ? "ón" : "ones"}
                        </p>
                        <p className="text-xs text-kb-text-muted">Podés borrar filas antes de guardar</p>
                      </div>

                      <div className="overflow-x-auto rounded-lg border border-kb-border-soft">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-kb-border-soft bg-kb-bg text-kb-text-secondary">
                              <th className="px-3 py-2 font-medium">Símbolo</th>
                              <th className="px-3 py-2 font-medium">Dir.</th>
                              <th className="px-3 py-2 font-medium">Qty</th>
                              <th className="px-3 py-2 font-medium">Entrada</th>
                              <th className="px-3 py-2 font-medium">Salida</th>
                              <th className="px-3 py-2 font-medium">P&amp;L</th>
                              <th className="px-3 py-2 font-medium">Fee</th>
                              <th className="px-3 py-2 font-medium">Hora entrada</th>
                              <th className="px-3 py-2"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {tradesOcr.map((t, i) => (
                              <tr key={i} className="border-b border-kb-border-soft last:border-0">
                                <td className="px-3 py-2 font-mono font-semibold text-kb-text">{t.symbol}</td>
                                <td className="px-3 py-2">
                                  <span
                                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                      t.side === "long"
                                        ? "bg-kb-gain/20 text-kb-gain"
                                        : "bg-kb-loss/20 text-kb-loss"
                                    }`}
                                  >
                                    {t.side === "long" ? "L" : "S"}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-kb-text">{t.quantity}</td>
                                <td className="px-3 py-2 font-mono text-kb-text">{t.entry_price}</td>
                                <td className="px-3 py-2 font-mono text-kb-text">
                                  {t.exit_price ?? "—"}
                                </td>
                                <td
                                  className={`px-3 py-2 font-mono font-semibold ${
                                    t.realized_pnl === null
                                      ? "text-kb-text-secondary"
                                      : t.realized_pnl >= 0
                                      ? "text-kb-gain"
                                      : "text-kb-loss"
                                  }`}
                                >
                                  {t.realized_pnl !== null
                                    ? (t.realized_pnl >= 0 ? "+" : "") + t.realized_pnl.toFixed(2)
                                    : "—"}
                                </td>
                                <td className="px-3 py-2 font-mono text-kb-text-secondary">
                                  {t.fees > 0 ? t.fees.toFixed(2) : "—"}
                                </td>
                                <td className="px-3 py-2 text-kb-text-secondary">
                                  {t.entry_time
                                    ? new Date(t.entry_time).toLocaleString("es-AR", {
                                        dateStyle: "short",
                                        timeStyle: "short",
                                      })
                                    : "—"}
                                </td>
                                <td className="px-3 py-2">
                                  <button
                                    onClick={() =>
                                      setTradesOcr((prev) => prev.filter((_, j) => j !== i))
                                    }
                                    className="text-kb-text-muted hover:text-kb-loss transition-colors"
                                    title="Eliminar fila"
                                  >
                                    ✕
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <Campo etiqueta="Guardar en la cuenta *">
                          <select
                            value={accountIdOcr}
                            onChange={(e) => setAccountIdOcr(e.target.value)}
                            className={inputClass}
                          >
                            <option value="">Elegí una cuenta…</option>
                            {cuentas.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </Campo>
                        <Campo etiqueta="Estrategia (opcional)">
                          <select
                            value={strategyIdOcr}
                            onChange={(e) => setStrategyIdOcr(e.target.value)}
                            className={inputClass}
                          >
                            <option value="">Sin estrategia</option>
                            {estrategias.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.name}
                              </option>
                            ))}
                          </select>
                        </Campo>
                      </div>

                      {errorOcr && (
                        <p className="rounded-lg border border-kb-loss/30 bg-kb-loss/10 px-3 py-2 text-xs text-kb-loss">
                          {errorOcr}
                        </p>
                      )}

                      {confirmandoGuardarOcr ? (
                        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4">
                          <p className="text-sm font-semibold text-yellow-400">⚠️ Atención: esto reemplaza las operaciones existentes</p>
                          <p className="mt-1 text-xs text-kb-text-secondary">
                            Los trades ya guardados para las mismas fechas en esta cuenta serán <span className="font-semibold text-kb-loss">borrados permanentemente</span> antes de insertar los nuevos. Esta acción no se puede deshacer.
                          </p>
                          <div className="mt-3 flex gap-2">
                            <button
                              onClick={() => { setConfirmandoGuardarOcr(false); guardarTradesOcr(); }}
                              disabled={guardandoOcr}
                              className="rounded-lg bg-kb-accent px-4 py-2 text-xs font-semibold text-kb-bg hover:brightness-110 transition disabled:opacity-60"
                            >
                              {guardandoOcr ? "Guardando…" : `Sí, reemplazar y guardar ${tradesOcr.length} operaci${tradesOcr.length === 1 ? "ón" : "ones"}`}
                            </button>
                            <button
                              onClick={() => setConfirmandoGuardarOcr(false)}
                              disabled={guardandoOcr}
                              className="rounded-lg border border-kb-border px-4 py-2 text-xs font-medium text-kb-text-secondary hover:text-kb-text transition disabled:opacity-60"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmandoGuardarOcr(true)}
                          disabled={guardandoOcr || tradesOcr.length === 0}
                          className="rounded-lg bg-kb-accent px-5 py-2.5 text-sm font-semibold text-kb-bg hover:brightness-110 transition disabled:opacity-60"
                        >
                          {guardandoOcr
                            ? "Guardando…"
                            : `Guardar ${tradesOcr.length} operaci${tradesOcr.length === 1 ? "ón" : "ones"}`}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* ─── Modo CSV (flujo original) ──────────────────────────────── */}
      {modoImportar === "csv" && paso === "subir" && (
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

      {modoImportar === "csv" && paso === "mapear" && (
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
                etiqueta="Tipo de instrumento por defecto"
                ayuda={mapeo.instrument_type !== undefined ? "Se usa solo si una fila no trae tipo claro" : "No mapeaste columna de tipo — se aplica este a todas las filas"}
              >
                <select value={instrumentTypeImport} onChange={(e) => setInstrumentTypeImport(e.target.value as InstrumentType)} className={inputClass}>
                  {Object.entries(INSTRUMENT_LABELS).map(([valor, etiqueta]) => (
                    <option key={valor} value={valor}>{etiqueta}</option>
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
              {mapeo.fees === undefined && (
                <Campo
                  etiqueta="Comisión por contrato/lote (opcional)"
                  ayuda="Tu archivo no trae columna de comisión — si cargás un número acá, se multiplica sola por la cantidad de cada fila"
                >
                  <input
                    type="number"
                    step="any"
                    value={comisionPorContrato}
                    onChange={(e) => setComisionPorContrato(e.target.value)}
                    placeholder="Ej. 1 (si tu bróker cobra $1 por contrato)"
                    className={inputClass}
                  />
                </Campo>
              )}
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

      {modoImportar === "csv" && paso === "revisar" && (
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

      {modoImportar === "csv" && paso === "listo" && resultado && (
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
  invertidoPorCuenta,
  historialFases,
  onCambio,
  onVerArchivadas,
}: {
  cuentas: Account[];
  trades: Trade[];
  pnlPorCuenta: Map<string, number>;
  retiradoPorCuenta: Map<string, number>;
  invertidoPorCuenta: Map<string, number>;
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
              invertido={invertidoPorCuenta.get(c.id) ?? c.purchase_cost ?? c.starting_balance}
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

    try {
      const [trades, accounts, strategies, withdrawals, achievements] = await Promise.all([
        supabase.from("trades").select("*"),
        supabase.from("accounts").select("*"),
        supabase.from("strategies").select("*"),
        supabase.from("withdrawals").select("*"),
        supabase.from("achievements").select("*"),
      ]);

      // Verificar errores individuales
      const errores = [trades.error, accounts.error, strategies.error, withdrawals.error, achievements.error].filter(Boolean);
      if (errores.length > 0) {
        console.error("exportarBackupCompleto: errores en queries", errores);
        setError("Error al obtener algunos datos. El backup puede estar incompleto.");
      }

      const backup = {
        exportado_en: new Date().toISOString(),
        cuentas: accounts.data ?? [],
        trades: trades.data ?? [],
        estrategias: strategies.data ?? [],
        retiros: withdrawals.data ?? [],
        logros: achievements.data ?? [],
      };
      descargarArchivo(JSON.stringify(backup, null, 2), `kebotrader-backup-${todayKey()}.json`, "application/json");
    } catch (e) {
      console.error("exportarBackupCompleto: error inesperado", e);
      setError("No se pudo generar el backup. Intentá de nuevo.");
    } finally {
      setExportando(null);
    }
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
  invertido,
  color,
  historial,
  onEditar,
  onCambio,
}: {
  cuenta: Account;
  trades: Trade[];
  pnl: number;
  retirado: number;
  invertido: number;
  color: { barra: string; punto: string };
  historial: PhaseHistoryEntry[];
  onEditar: () => void;
  onCambio: () => void;
}) {
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false);
  const [confirmandoQuemar, setConfirmandoQuemar] = useState(false);
  const [confirmandoArchivar, setConfirmandoArchivar] = useState(false);
  const [confirmandoFondear, setConfirmandoFondear] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [conteo, setConteo] = useState<{ trades: number; retiros: number } | null>(null);
  const [cargandoConteo, setCargandoConteo] = useState(false);
  const [errorEliminar, setErrorEliminar] = useState<string | null>(null);
  useCerrarConEscape(() => {
    setConfirmandoEliminar(false);
    setConfirmandoQuemar(false);
    setConfirmandoFondear(false);
    setErrorEliminar(null);
  });

  const cerrados = useMemo(
    () => trades.filter((t) => t.account_id === cuenta.id && t.status === "closed" && t.realized_pnl !== null),
    [trades, cuenta.id]
  );
  const ganadores = cerrados.filter((t) => (t.realized_pnl ?? 0) > 0).length;
  const winRate = cerrados.length > 0 ? (ganadores / cerrados.length) * 100 : null;
  // invertido viene como prop desde ConfiguracionView (usa la tabla investments,
  // con purchase_cost como fallback y starting_balance como último recurso).

  // ---- Progreso hacia el objetivo de la fase actual (mismo cálculo que
  // en el Dashboard, para que también se vea acá sin tener que
  // seleccionar la cuenta o abrir "Editar"). ----
  const pnlDesdeInicioFase = useMemo(() => {
    const inicioFase = new Date(cuenta.phase_started_at).getTime();
    return cerrados
      .filter((t) => new Date(t.exit_time ?? t.entry_time).getTime() >= inicioFase)
      .reduce((acc, t) => acc + (t.realized_pnl ?? 0), 0);
  }, [cerrados, cuenta.phase_started_at]);

  const objetivoFaseMonto =
    cuenta.phase_target_percent !== null ? (cuenta.starting_balance * cuenta.phase_target_percent) / 100 : null;
  const progresoFasePorcentaje =
    objetivoFaseMonto && objetivoFaseMonto > 0
      ? Math.min((pnlDesdeInicioFase / objetivoFaseMonto) * 100, 100)
      : 0;

  async function fondearCuenta() {
    setProcesando(true);

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    // Registrar el avance en el historial (igual que avanzarFase en el
    // componente principal) para poder ver cuándo se fondeó y con qué P&L.
    if (userId) {
      const { error: histError } = await supabase.from("phase_history").insert({
        account_id: cuenta.id,
        user_id: userId,
        phase: cuenta.phase,            // la fase que se SUPERA (ej. "fase_1" o "fase_2")
        target_percent: cuenta.phase_target_percent,
        pnl_alcanzado: pnlDesdeInicioFase,
      });
      if (histError) {
        console.error("[fondearCuenta] Error al guardar historial de fase:", histError.message);
        setProcesando(false);
        return; // no avanzar si no se pudo registrar el historial
      }
    }

    const { error: updateError } = await supabase
      .from("accounts")
      .update({
        phase: "financiada",
        phase_started_at: new Date().toISOString(),
      })
      .eq("id", cuenta.id);

    if (updateError) {
      console.error("[fondearCuenta] Error al actualizar cuenta:", updateError.message);
      setProcesando(false);
      return;
    }

    setProcesando(false);
    onCambio();
  }

  async function archivar() {
    setProcesando(true);
    const { error: archErr } = await supabase
      .from("accounts")
      .update({ is_archived: true })
      .eq("id", cuenta.id);
    setProcesando(false);
    if (archErr) return;
    onCambio();
  }

  async function quemar() {
    setProcesando(true);
    const { error: qErr } = await supabase
      .from("accounts")
      .update({ blown_at: new Date().toISOString(), is_archived: true })
      .eq("id", cuenta.id);
    setProcesando(false);
    if (qErr) {
      setConfirmandoQuemar(false);
      return;
    }
    setConfirmandoQuemar(false);
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
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                cuenta.phase === "financiada"
                  ? "bg-kb-gain/15 text-kb-gain"
                  : "bg-kb-accent/10 text-kb-accent"
              }`}>
                {cuenta.phase === "financiada" ? "✓ FONDEADA" : PHASE_LABELS[cuenta.phase]}
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
            onClick={() => setConfirmandoQuemar(true)}
            disabled={procesando}
            className="rounded-lg border border-kb-border p-1.5 text-kb-text-secondary hover:border-orange-500 hover:text-orange-500 transition-colors disabled:opacity-60"
            aria-label="Marcar como quemada"
            title="Quemar cuenta"
          >
            🔥
          </button>
          <button
            onClick={() => setConfirmandoArchivar(true)}
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

      {/* ── Confirmación de quemar ── */}
      {confirmandoQuemar && (
        <div className="mx-5 mb-3 rounded-xl border border-orange-500/40 bg-orange-500/8 p-4">
          <p className="text-sm font-semibold text-orange-400">🔥 ¿Marcar como quemada?</p>
          <p className="mt-1 text-xs text-kb-text-secondary">
            La cuenta se archivará con estado <span className="font-medium text-orange-400">QUEMADA</span>.
            Todos los trades, retiros e historial quedan guardados — podés consultarlos en "Cuentas archivadas".
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={quemar}
              disabled={procesando}
              className="rounded-lg bg-orange-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-orange-600 transition-colors disabled:opacity-60"
            >
              {procesando ? "Procesando…" : "Sí, quemar"}
            </button>
            <button
              onClick={() => setConfirmandoQuemar(false)}
              disabled={procesando}
              className="rounded-lg border border-kb-border px-4 py-1.5 text-xs font-medium text-kb-text-secondary hover:text-kb-text transition-colors disabled:opacity-60"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ── Confirmación de archivar ── */}
      {confirmandoArchivar && (
        <div className="mx-5 mb-3 rounded-xl border border-kb-border bg-kb-bg p-4">
          <p className="text-sm font-semibold text-kb-text">🗂 ¿Archivar &quot;{cuenta.name}&quot;?</p>
          <p className="mt-1 text-xs text-kb-text-secondary">
            La cuenta se moverá a <span className="font-medium text-kb-text">Cuentas archivadas</span>.
            Todos los trades, retiros e historial quedan guardados — podés desarchivarla cuando quieras.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => { setConfirmandoArchivar(false); archivar(); }}
              disabled={procesando}
              className="rounded-lg bg-kb-text-secondary px-4 py-1.5 text-xs font-semibold text-kb-bg hover:brightness-110 transition-colors disabled:opacity-60"
            >
              {procesando ? "Archivando…" : "Sí, archivar"}
            </button>
            <button
              onClick={() => setConfirmandoArchivar(false)}
              disabled={procesando}
              className="rounded-lg border border-kb-border px-4 py-1.5 text-xs font-medium text-kb-text-secondary hover:text-kb-text transition-colors disabled:opacity-60"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

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

      {cuenta.account_type === "real" && cuenta.phase !== "financiada" && cuenta.phase !== "no_aplica" && (
        confirmandoFondear ? (
          <div className="border-t border-kb-border-soft px-5 py-3 bg-kb-gain/5">
            <p className="text-xs font-semibold text-kb-gain">🎯 ¿Marcar &quot;{cuenta.name}&quot; como Fondeada?</p>
            <p className="mt-0.5 text-xs text-kb-text-secondary">
              Esto registrará el avance de fase. No se pueden deshacer los cambios.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => { setConfirmandoFondear(false); fondearCuenta(); }}
                disabled={procesando}
                className="rounded-lg bg-kb-gain px-4 py-1.5 text-xs font-semibold text-kb-bg hover:brightness-110 transition-colors disabled:opacity-60"
              >
                {procesando ? "Procesando…" : "Sí, fondear"}
              </button>
              <button
                onClick={() => setConfirmandoFondear(false)}
                disabled={procesando}
                className="rounded-lg border border-kb-border px-4 py-1.5 text-xs font-medium text-kb-text-secondary hover:text-kb-text transition-colors disabled:opacity-60"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirmandoFondear(true)}
            disabled={procesando}
            className="flex w-full items-center justify-center gap-1.5 border-t border-kb-border-soft px-5 py-2.5 text-xs font-medium text-kb-gain hover:bg-kb-gain/5 transition-colors disabled:opacity-60"
          >
            🎯 Marcar como Fondeada
          </button>
        )
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
// DATOS DE PROP FIRMS (plantillas para autocompletar nueva cuenta)
// =====================================================================

type PlanPropFirm = {
  nombre: string;
  grupo?: string;   // categoría dentro de la firma (ej. "Flex", "Pro", "Intraday", "EOD")
  balance: number;
  objetivoPct: number;
  drawdownTotal: number;
  perdidaDiaria: number | null;
  challengeType: AccountChallengeType;
  costo: number;
  tipoCosto: "mensual" | "único";
};

const FIRMAS_PROP: { id: string; nombre: string; planes: PlanPropFirm[] }[] = [
  // ── Apex Trader Funding ─────────────────────────────────────────────
  // Intraday: trailing MLL intraday, sin DLL. EOD: trailing EOD, con DLL incluido.
  // Ambos modalidades son suscripción mensual.
  {
    id: "apex",
    nombre: "Apex Trader Funding",
    planes: [
      // Intraday (trailing intraday, sin DLL)
      { nombre: "25K Intraday",  grupo: "Intraday", balance: 25000,  objetivoPct: 6, drawdownTotal: 1000, perdidaDiaria: null, challengeType: "una_fase", costo: 118, tipoCosto: "mensual" },
      { nombre: "50K Intraday",  grupo: "Intraday", balance: 50000,  objetivoPct: 6, drawdownTotal: 2000, perdidaDiaria: null, challengeType: "una_fase", costo: 131, tipoCosto: "mensual" },
      { nombre: "100K Intraday", grupo: "Intraday", balance: 100000, objetivoPct: 6, drawdownTotal: 3000, perdidaDiaria: null, challengeType: "una_fase", costo: 198, tipoCosto: "mensual" },
      { nombre: "150K Intraday", grupo: "Intraday", balance: 150000, objetivoPct: 6, drawdownTotal: 4000, perdidaDiaria: null, challengeType: "una_fase", costo: 265, tipoCosto: "mensual" },
      // EOD (trailing EOD, con DLL)
      { nombre: "25K EOD",  grupo: "EOD", balance: 25000,  objetivoPct: 6, drawdownTotal: 1000, perdidaDiaria: 500,  challengeType: "una_fase", costo: 177, tipoCosto: "mensual" },
      { nombre: "50K EOD",  grupo: "EOD", balance: 50000,  objetivoPct: 6, drawdownTotal: 2000, perdidaDiaria: 1000, challengeType: "una_fase", costo: 197, tipoCosto: "mensual" },
      { nombre: "100K EOD", grupo: "EOD", balance: 100000, objetivoPct: 6, drawdownTotal: 3000, perdidaDiaria: 1500, challengeType: "una_fase", costo: 297, tipoCosto: "mensual" },
      { nombre: "150K EOD", grupo: "EOD", balance: 150000, objetivoPct: 6, drawdownTotal: 4000, perdidaDiaria: 2000, challengeType: "una_fase", costo: 397, tipoCosto: "mensual" },
    ],
  },
  // ── Topstep ─────────────────────────────────────────────────────────
  // Trailing EOD, sin DLL (DLL eliminado para cuentas nuevas desde 2026).
  // Precios estándar: $49/$99/$149/mes. Suscripción mensual.
  {
    id: "topstep",
    nombre: "Topstep",
    planes: [
      { nombre: "50K",  balance: 50000,  objetivoPct: 6, drawdownTotal: 2000, perdidaDiaria: null, challengeType: "una_fase", costo: 49,  tipoCosto: "mensual" },
      { nombre: "100K", balance: 100000, objetivoPct: 6, drawdownTotal: 3000, perdidaDiaria: null, challengeType: "una_fase", costo: 99,  tipoCosto: "mensual" },
      { nombre: "150K", balance: 150000, objetivoPct: 6, drawdownTotal: 4500, perdidaDiaria: null, challengeType: "una_fase", costo: 149, tipoCosto: "mensual" },
    ],
  },
  // ── Tradeify ─────────────────────────────────────────────────────────
  // Select: sin DLL, suscripción mensual. Growth: con DLL, suscripción mensual.
  // Select 50K: objetivo 5% (no 6%). Drawdowns corregidos según datos reales.
  {
    id: "tradeify",
    nombre: "Tradeify",
    planes: [
      // Select (sin DLL)
      { nombre: "Select 50K",  grupo: "Select", balance: 50000,  objetivoPct: 5, drawdownTotal: 2000, perdidaDiaria: null, challengeType: "una_fase", costo: 159, tipoCosto: "mensual" },
      { nombre: "Select 100K", grupo: "Select", balance: 100000, objetivoPct: 6, drawdownTotal: 3000, perdidaDiaria: null, challengeType: "una_fase", costo: 259, tipoCosto: "mensual" },
      { nombre: "Select 150K", grupo: "Select", balance: 150000, objetivoPct: 6, drawdownTotal: 4500, perdidaDiaria: null, challengeType: "una_fase", costo: 359, tipoCosto: "mensual" },
      // Growth (con DLL — más barato que Select)
      { nombre: "Growth 50K",  grupo: "Growth", balance: 50000,  objetivoPct: 6, drawdownTotal: 2000, perdidaDiaria: 1250, challengeType: "una_fase", costo: 139, tipoCosto: "mensual" },
      { nombre: "Growth 100K", grupo: "Growth", balance: 100000, objetivoPct: 6, drawdownTotal: 3500, perdidaDiaria: 2500, challengeType: "una_fase", costo: 249, tipoCosto: "mensual" },
      { nombre: "Growth 150K", grupo: "Growth", balance: 150000, objetivoPct: 6, drawdownTotal: 5000, perdidaDiaria: 3750, challengeType: "una_fase", costo: 359, tipoCosto: "mensual" },
    ],
  },
  // ── TradeDay ─────────────────────────────────────────────────────────
  // Intraday: trailing intraday, sin DLL. EOD: trailing EOD, sin DLL. Ambos pago único.
  // Precios reales: Intraday $87/$140/$210, EOD $122/$192/$262.
  {
    id: "tradeday",
    nombre: "TradeDay",
    planes: [
      // Intraday
      { nombre: "50K Intraday",  grupo: "Intraday", balance: 50000,  objetivoPct: 6, drawdownTotal: 2000, perdidaDiaria: null, challengeType: "una_fase", costo: 87,  tipoCosto: "único" },
      { nombre: "100K Intraday", grupo: "Intraday", balance: 100000, objetivoPct: 6, drawdownTotal: 3000, perdidaDiaria: null, challengeType: "una_fase", costo: 140, tipoCosto: "único" },
      { nombre: "150K Intraday", grupo: "Intraday", balance: 150000, objetivoPct: 6, drawdownTotal: 4500, perdidaDiaria: null, challengeType: "una_fase", costo: 210, tipoCosto: "único" },
      // EOD
      { nombre: "50K EOD",  grupo: "EOD", balance: 50000,  objetivoPct: 6, drawdownTotal: 2000, perdidaDiaria: null, challengeType: "una_fase", costo: 122, tipoCosto: "único" },
      { nombre: "100K EOD", grupo: "EOD", balance: 100000, objetivoPct: 6, drawdownTotal: 3000, perdidaDiaria: null, challengeType: "una_fase", costo: 192, tipoCosto: "único" },
      { nombre: "150K EOD", grupo: "EOD", balance: 150000, objetivoPct: 6, drawdownTotal: 4500, perdidaDiaria: null, challengeType: "una_fase", costo: 262, tipoCosto: "único" },
    ],
  },
  // ── MyFundedFutures ──────────────────────────────────────────────────
  // Rapid: trailing EOD, sin DLL. Pago único.
  {
    id: "mff",
    nombre: "MyFundedFutures",
    planes: [
      { nombre: "25K Rapid", balance: 25000, objetivoPct: 6, drawdownTotal: 1000, perdidaDiaria: null, challengeType: "una_fase", costo: 109, tipoCosto: "único" },
      { nombre: "50K Rapid", balance: 50000, objetivoPct: 6, drawdownTotal: 2000, perdidaDiaria: null, challengeType: "una_fase", costo: 149, tipoCosto: "único" },
      { nombre: "100K Rapid", balance: 100000, objetivoPct: 6, drawdownTotal: 3000, perdidaDiaria: null, challengeType: "una_fase", costo: 339, tipoCosto: "único" },
      { nombre: "150K Rapid", balance: 150000, objetivoPct: 6, drawdownTotal: 4500, perdidaDiaria: null, challengeType: "una_fase", costo: 489, tipoCosto: "único" },
    ],
  },
  // ── Earn2Trade ───────────────────────────────────────────────────────
  // Gauntlet Mini: 1 fase, trailing EOD + DLL fijo. TCP: 2 fases, DLL opcional (2.2%). Ambos pago único.
  // TCP precios reales: $150/$190/$350. TCP 25K objetivo 7% (no 6%).
  {
    id: "earn2trade",
    nombre: "Earn2Trade",
    planes: [
      // Gauntlet Mini (con DLL fijo)
      { nombre: "Gauntlet Mini 50K",  grupo: "Gauntlet Mini", balance: 50000,  objetivoPct: 6, drawdownTotal: 2000, perdidaDiaria: 1100, challengeType: "una_fase", costo: 170, tipoCosto: "único" },
      { nombre: "Gauntlet Mini 100K", grupo: "Gauntlet Mini", balance: 100000, objetivoPct: 6, drawdownTotal: 3500, perdidaDiaria: 2200, challengeType: "una_fase", costo: 315, tipoCosto: "único" },
      { nombre: "Gauntlet Mini 150K", grupo: "Gauntlet Mini", balance: 150000, objetivoPct: 6, drawdownTotal: 4500, perdidaDiaria: 3300, challengeType: "una_fase", costo: 375, tipoCosto: "único" },
      { nombre: "Gauntlet Mini 200K", grupo: "Gauntlet Mini", balance: 200000, objetivoPct: 5, drawdownTotal: 6000, perdidaDiaria: 4400, challengeType: "una_fase", costo: 550, tipoCosto: "único" },
      // TCP - The Trader Career Path (2 fases, DLL opcional — mismo precio con o sin)
      { nombre: "TCP 25K sin DLL",  grupo: "TCP", balance: 25000,  objetivoPct: 7, drawdownTotal: 1500, perdidaDiaria: null, challengeType: "dos_fases", costo: 150, tipoCosto: "único" },
      { nombre: "TCP 25K con DLL",  grupo: "TCP", balance: 25000,  objetivoPct: 7, drawdownTotal: 1500, perdidaDiaria: 550,  challengeType: "dos_fases", costo: 150, tipoCosto: "único" },
      { nombre: "TCP 50K sin DLL",  grupo: "TCP", balance: 50000,  objetivoPct: 6, drawdownTotal: 2000, perdidaDiaria: null, challengeType: "dos_fases", costo: 190, tipoCosto: "único" },
      { nombre: "TCP 50K con DLL",  grupo: "TCP", balance: 50000,  objetivoPct: 6, drawdownTotal: 2000, perdidaDiaria: 1100, challengeType: "dos_fases", costo: 190, tipoCosto: "único" },
      { nombre: "TCP 100K sin DLL", grupo: "TCP", balance: 100000, objetivoPct: 6, drawdownTotal: 3500, perdidaDiaria: null, challengeType: "dos_fases", costo: 350, tipoCosto: "único" },
      { nombre: "TCP 100K con DLL", grupo: "TCP", balance: 100000, objetivoPct: 6, drawdownTotal: 3500, perdidaDiaria: 2200, challengeType: "dos_fases", costo: 350, tipoCosto: "único" },
    ],
  },
  // ── Lucid Trading ────────────────────────────────────────────────────
  // LucidFlex: DLL opcional (mismo precio con o sin). LucidPro: DLL opcional (mismo precio).
  // LucidDirect: cuenta instantánea (ya fondeada). Todos pago único.
  // Precios Flex confirmados desde dashboard: 25K=$89, 50K=$146, 100K=$283, 150K=$420.
  {
    id: "lucid",
    nombre: "Lucid Trading",
    planes: [
      // LucidFlex (DLL opcional — mismo precio con o sin)
      { nombre: "LucidFlex 25K sin DLL",  grupo: "Flex", balance: 25000,  objetivoPct: 5, drawdownTotal: 1000, perdidaDiaria: null, challengeType: "una_fase", costo: 89,  tipoCosto: "único" },
      { nombre: "LucidFlex 25K con DLL",  grupo: "Flex", balance: 25000,  objetivoPct: 5, drawdownTotal: 1000, perdidaDiaria: 600,  challengeType: "una_fase", costo: 89,  tipoCosto: "único" },
      { nombre: "LucidFlex 50K sin DLL",  grupo: "Flex", balance: 50000,  objetivoPct: 6, drawdownTotal: 2000, perdidaDiaria: null, challengeType: "una_fase", costo: 146, tipoCosto: "único" },
      { nombre: "LucidFlex 50K con DLL",  grupo: "Flex", balance: 50000,  objetivoPct: 6, drawdownTotal: 2000, perdidaDiaria: 1200, challengeType: "una_fase", costo: 146, tipoCosto: "único" },
      { nombre: "LucidFlex 100K sin DLL", grupo: "Flex", balance: 100000, objetivoPct: 6, drawdownTotal: 3000, perdidaDiaria: null, challengeType: "una_fase", costo: 283, tipoCosto: "único" },
      { nombre: "LucidFlex 100K con DLL", grupo: "Flex", balance: 100000, objetivoPct: 6, drawdownTotal: 3000, perdidaDiaria: 1800, challengeType: "una_fase", costo: 283, tipoCosto: "único" },
      { nombre: "LucidFlex 150K sin DLL", grupo: "Flex", balance: 150000, objetivoPct: 6, drawdownTotal: 4500, perdidaDiaria: null, challengeType: "una_fase", costo: 420, tipoCosto: "único" },
      { nombre: "LucidFlex 150K con DLL", grupo: "Flex", balance: 150000, objetivoPct: 6, drawdownTotal: 4500, perdidaDiaria: 2700, challengeType: "una_fase", costo: 420, tipoCosto: "único" },
      // LucidPro sin DLL (toggle OFF — mismo precio)
      { nombre: "LucidPro 25K sin DLL",  grupo: "Pro", balance: 25000,  objetivoPct: 5, drawdownTotal: 1000, perdidaDiaria: null, challengeType: "una_fase", costo: 123, tipoCosto: "único" },
      { nombre: "LucidPro 50K sin DLL",  grupo: "Pro", balance: 50000,  objetivoPct: 6, drawdownTotal: 2000, perdidaDiaria: null, challengeType: "una_fase", costo: 192, tipoCosto: "único" },
      { nombre: "LucidPro 100K sin DLL", grupo: "Pro", balance: 100000, objetivoPct: 6, drawdownTotal: 3000, perdidaDiaria: null, challengeType: "una_fase", costo: 307, tipoCosto: "único" },
      { nombre: "LucidPro 150K sin DLL", grupo: "Pro", balance: 150000, objetivoPct: 6, drawdownTotal: 4500, perdidaDiaria: null, challengeType: "una_fase", costo: 370, tipoCosto: "único" },
      // LucidPro con DLL (toggle ON — mismo precio)
      { nombre: "LucidPro 25K con DLL",  grupo: "Pro", balance: 25000,  objetivoPct: 5, drawdownTotal: 1000, perdidaDiaria: 600,  challengeType: "una_fase", costo: 123, tipoCosto: "único" },
      { nombre: "LucidPro 50K con DLL",  grupo: "Pro", balance: 50000,  objetivoPct: 6, drawdownTotal: 2000, perdidaDiaria: 1200, challengeType: "una_fase", costo: 192, tipoCosto: "único" },
      { nombre: "LucidPro 100K con DLL", grupo: "Pro", balance: 100000, objetivoPct: 6, drawdownTotal: 3000, perdidaDiaria: 1800, challengeType: "una_fase", costo: 307, tipoCosto: "único" },
      { nombre: "LucidPro 150K con DLL", grupo: "Pro", balance: 150000, objetivoPct: 6, drawdownTotal: 4500, perdidaDiaria: 2700, challengeType: "una_fase", costo: 370, tipoCosto: "único" },
      // LucidDirect (cuenta ya fondeada — instantánea)
      { nombre: "LucidDirect 25K",         grupo: "Direct", balance: 25000,  objetivoPct: 5, drawdownTotal: 1000, perdidaDiaria: null, challengeType: "instantanea", costo: 340, tipoCosto: "único" },
      { nombre: "LucidDirect 50K con DLL", grupo: "Direct", balance: 50000,  objetivoPct: 6, drawdownTotal: 2000, perdidaDiaria: 1200, challengeType: "instantanea", costo: 520, tipoCosto: "único" },
      { nombre: "LucidDirect 100K con DLL",grupo: "Direct", balance: 100000, objetivoPct: 6, drawdownTotal: 3500, perdidaDiaria: 2100, challengeType: "instantanea", costo: 700, tipoCosto: "único" },
      { nombre: "LucidDirect 150K con DLL",grupo: "Direct", balance: 150000, objetivoPct: 6, drawdownTotal: 5000, perdidaDiaria: 3000, challengeType: "instantanea", costo: 840, tipoCosto: "único" },
    ],
  },
  // ── Bulenox ──────────────────────────────────────────────────────────
  // Trailing EOD. DLL opcional (mismo precio con o sin). Pago ÚNICO desde ago 2026.
  // Precios: $145/$175/$215/$325. Plan 250K discontinuado.
  {
    id: "bulenox",
    nombre: "Bulenox",
    planes: [
      { nombre: "25K sin DLL",  balance: 25000,  objetivoPct: 6, drawdownTotal: 1500, perdidaDiaria: null, challengeType: "una_fase", costo: 145, tipoCosto: "único" },
      { nombre: "25K con DLL",  balance: 25000,  objetivoPct: 6, drawdownTotal: 1500, perdidaDiaria: 500,  challengeType: "una_fase", costo: 145, tipoCosto: "único" },
      { nombre: "50K sin DLL",  balance: 50000,  objetivoPct: 6, drawdownTotal: 2500, perdidaDiaria: null, challengeType: "una_fase", costo: 175, tipoCosto: "único" },
      { nombre: "50K con DLL",  balance: 50000,  objetivoPct: 6, drawdownTotal: 2500, perdidaDiaria: 1100, challengeType: "una_fase", costo: 175, tipoCosto: "único" },
      { nombre: "100K sin DLL", balance: 100000, objetivoPct: 6, drawdownTotal: 3000, perdidaDiaria: null, challengeType: "una_fase", costo: 215, tipoCosto: "único" },
      { nombre: "100K con DLL", balance: 100000, objetivoPct: 6, drawdownTotal: 3000, perdidaDiaria: 2200, challengeType: "una_fase", costo: 215, tipoCosto: "único" },
      { nombre: "150K sin DLL", balance: 150000, objetivoPct: 6, drawdownTotal: 4500, perdidaDiaria: null, challengeType: "una_fase", costo: 325, tipoCosto: "único" },
      { nombre: "150K con DLL", balance: 150000, objetivoPct: 6, drawdownTotal: 4500, perdidaDiaria: 3300, challengeType: "una_fase", costo: 325, tipoCosto: "único" },
    ],
  },
  // ── Take Profit Trader ───────────────────────────────────────────────
  // Trailing drawdown EOD, sin DLL. Suscripción mensual.
  {
    id: "tpt",
    nombre: "Take Profit Trader",
    planes: [
      { nombre: "25K", balance: 25000, objetivoPct: 5, drawdownTotal: 1500, perdidaDiaria: null, challengeType: "una_fase", costo: 150, tipoCosto: "mensual" },
      { nombre: "50K", balance: 50000, objetivoPct: 6, drawdownTotal: 2000, perdidaDiaria: null, challengeType: "una_fase", costo: 170, tipoCosto: "mensual" },
      { nombre: "75K", balance: 75000, objetivoPct: 6, drawdownTotal: 2500, perdidaDiaria: null, challengeType: "una_fase", costo: 245, tipoCosto: "mensual" },
      { nombre: "100K", balance: 100000, objetivoPct: 6, drawdownTotal: 3000, perdidaDiaria: null, challengeType: "una_fase", costo: 330, tipoCosto: "mensual" },
      { nombre: "150K", balance: 150000, objetivoPct: 6, drawdownTotal: 4500, perdidaDiaria: null, challengeType: "una_fase", costo: 360, tipoCosto: "mensual" },
    ],
  },
  // ── Alpha Futures ────────────────────────────────────────────────────
  // Standard/Advanced: trailing EOD, sin DLL. Zero: con DLL incluido. Suscripción mensual.
  // Direct: DISCONTINUADO — eliminado del sitio. Precios corregidos desde alphafutures.com.
  {
    id: "alpha",
    nombre: "Alpha Futures",
    planes: [
      // Standard (sin DLL) — precios reales: $79/$159/$239. Drawdowns 100K/150K corregidos.
      { nombre: "Standard 50K",  grupo: "Standard", balance: 50000,  objetivoPct: 6, drawdownTotal: 2000, perdidaDiaria: null, challengeType: "una_fase", costo: 79,  tipoCosto: "mensual" },
      { nombre: "Standard 100K", grupo: "Standard", balance: 100000, objetivoPct: 6, drawdownTotal: 4000, perdidaDiaria: null, challengeType: "una_fase", costo: 159, tipoCosto: "mensual" },
      { nombre: "Standard 150K", grupo: "Standard", balance: 150000, objetivoPct: 6, drawdownTotal: 6000, perdidaDiaria: null, challengeType: "una_fase", costo: 239, tipoCosto: "mensual" },
      // Advanced (sin DLL, mayor objetivo) — precios reales: $139/$279/$419
      { nombre: "Advanced 50K",  grupo: "Advanced", balance: 50000,  objetivoPct: 8, drawdownTotal: 1750, perdidaDiaria: null, challengeType: "una_fase", costo: 139, tipoCosto: "mensual" },
      { nombre: "Advanced 100K", grupo: "Advanced", balance: 100000, objetivoPct: 8, drawdownTotal: 3500, perdidaDiaria: null, challengeType: "una_fase", costo: 279, tipoCosto: "mensual" },
      { nombre: "Advanced 150K", grupo: "Advanced", balance: 150000, objetivoPct: 8, drawdownTotal: 5250, perdidaDiaria: null, challengeType: "una_fase", costo: 419, tipoCosto: "mensual" },
      // Zero (con DLL — sin comisiones en cuenta fondeada) — precios reales: $99/$199. Sin plan 25K.
      { nombre: "Zero 50K",  grupo: "Zero", balance: 50000,  objetivoPct: 6, drawdownTotal: 2000, perdidaDiaria: 1000, challengeType: "una_fase", costo: 99,  tipoCosto: "mensual" },
      { nombre: "Zero 100K", grupo: "Zero", balance: 100000, objetivoPct: 6, drawdownTotal: 3000, perdidaDiaria: 2000, challengeType: "una_fase", costo: 199, tipoCosto: "mensual" },
    ],
  },
  // ── FundedNext Futures ───────────────────────────────────────────────
  // Legacy: trailing EOD, sin DLL. Bolt: con DLL. Rapid: trailing EOD, sin DLL. Pago único.
  {
    id: "fundednext",
    nombre: "FundedNext Futures",
    planes: [
      // Legacy (sin DLL)
      { nombre: "Legacy 25K",  grupo: "Legacy", balance: 25000,  objetivoPct: 5, drawdownTotal: 1000, perdidaDiaria: null, challengeType: "una_fase", costo: 80,  tipoCosto: "único" },
      { nombre: "Legacy 50K",  grupo: "Legacy", balance: 50000,  objetivoPct: 5, drawdownTotal: 2000, perdidaDiaria: null, challengeType: "una_fase", costo: 150, tipoCosto: "único" },
      { nombre: "Legacy 100K", grupo: "Legacy", balance: 100000, objetivoPct: 6, drawdownTotal: 3000, perdidaDiaria: null, challengeType: "una_fase", costo: 250, tipoCosto: "único" },
      // Bolt (con DLL)
      { nombre: "Bolt 50K", grupo: "Bolt", balance: 50000, objetivoPct: 6, drawdownTotal: 2000, perdidaDiaria: 1000, challengeType: "una_fase", costo: 100, tipoCosto: "único" },
      // Rapid (sin DLL)
      { nombre: "Rapid 25K",  grupo: "Rapid", balance: 25000,  objetivoPct: 6, drawdownTotal: 1000, perdidaDiaria: null, challengeType: "una_fase", costo: 150, tipoCosto: "único" },
      { nombre: "Rapid 50K",  grupo: "Rapid", balance: 50000,  objetivoPct: 6, drawdownTotal: 2000, perdidaDiaria: null, challengeType: "una_fase", costo: 200, tipoCosto: "único" },
      { nombre: "Rapid 100K", grupo: "Rapid", balance: 100000, objetivoPct: 5, drawdownTotal: 2500, perdidaDiaria: null, challengeType: "una_fase", costo: 280, tipoCosto: "único" },
    ],
  },
];

// Metadatos visuales de cada prop firm (abbr, colores, dominio para logo)
const FIRMA_META: Record<string, { abbr: string; color: string; bg: string; domain: string }> = {
  apex:       { abbr: "ATF", color: "#f97316", bg: "rgba(249,115,22,0.15)",  domain: "apextraderfunding.com" },
  topstep:    { abbr: "TS",  color: "#3b82f6", bg: "rgba(59,130,246,0.15)",  domain: "topstep.com" },
  tradeify:   { abbr: "TF",  color: "#10b981", bg: "rgba(16,185,129,0.15)",  domain: "tradeify.com" },
  tradeday:   { abbr: "TD",  color: "#8b5cf6", bg: "rgba(139,92,246,0.15)",  domain: "tradeday.com" },
  mff:        { abbr: "MFF", color: "#f59e0b", bg: "rgba(245,158,11,0.15)",  domain: "myfundedfutures.com" },
  earn2trade: { abbr: "E2T", color: "#ef4444", bg: "rgba(239,68,68,0.15)",   domain: "earn2trade.com" },
  lucid:      { abbr: "LT",  color: "#06b6d4", bg: "rgba(6,182,212,0.15)",   domain: "lucidtrading.com" },
  bulenox:    { abbr: "BX",  color: "#6366f1", bg: "rgba(99,102,241,0.15)",  domain: "bulenox.com" },
  tpt:        { abbr: "TPT", color: "#22c55e", bg: "rgba(34,197,94,0.15)",   domain: "takeprofittrader.com" },
  alpha:      { abbr: "AF",  color: "#a855f7", bg: "rgba(168,85,247,0.15)",  domain: "alphafutures.com" },
  fundednext: { abbr: "FNF", color: "#fb923c", bg: "rgba(251,146,60,0.15)",  domain: "fundednext.com" },
};

// Componente logo de prop firm.
// Cascade: Google Favicons (alta resolución) → DuckDuckGo → abreviatura con color de marca.
// Clearbit se omite: ahora es servicio de pago y devuelve imagen vacía en vez de 404,
// lo que impide que onError se dispare y el logo queda invisible.
function FirmaLogo({
  domain, abbr, color, bg, alt,
}: {
  domain: string; abbr: string; color: string; bg: string; alt: string;
}) {
  // Cascade de fuentes de logo. t0.gstatic.com/faviconV2 queda descartado: devuelve un globo
  // genérico de Google (sin onError) para dominios sin favicon indexado, lo que hace que
  // el logo "cargue" sin mostrar nada real. Clearbit también queda descartado: ahora es
  // servicio de pago y devuelve imagen vacía (HTTP 200) en vez de 404, lo que impide que
  // onError se dispare y el logo queda invisible. Orden actual:
  //   1. Google Favicons clásico (?sz=64) — no inventa íconos, dispara onError si no hay nada
  //   2. DuckDuckGo — amplio caché de favicons reales
  //   3. icon.horse — agregador con cobertura muy amplia para sitios sin favicon propio
  //   4. Favicon.ico directo en el dominio — último recurso antes de la abreviatura
  //   5. Abreviatura con color de marca (siempre visible)
  const [src, setSrc] = useState(
    domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : ""
  );
  const [fallback, setFallback] = useState(!domain);
  const intento = useRef(0);

  function handleError() {
    intento.current += 1;
    if (intento.current === 1 && domain) {
      setSrc(`https://icons.duckduckgo.com/ip3/${domain}.ico`);
    } else if (intento.current === 2 && domain) {
      setSrc(`https://icon.horse/icon/${domain}`);
    } else if (intento.current === 3 && domain) {
      setSrc(`https://${domain}/favicon.ico`);
    } else {
      setFallback(true);
    }
  }

  return (
    <span
      className="flex-shrink-0 flex items-center justify-center rounded-md overflow-hidden"
      style={{ width: 28, height: 28, backgroundColor: bg }}
    >
      {fallback ? (
        <span
          className="flex items-center justify-center text-[9px] font-bold w-full h-full"
          style={{ color }}
        >
          {abbr}
        </span>
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt={alt}
          width={20}
          height={20}
          style={{ objectFit: "contain" }}
          onError={handleError}
        />
      )}
    </span>
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

  // Selector de prop firm
  const [firmaId, setFirmaId] = useState<string | null>(null);
  const [planIdx, setPlanIdx] = useState<number | null>(null);
  const [plantillaAplicada, setPlantillaAplicada] = useState(false);
  const [usarDailyLoss, setUsarDailyLoss] = useState(true);
  // Cascading selector: paso 1 = monto, paso 2 = grupo, paso 3 = DLL
  const [montoSel, setMontoSel] = useState<number | null>(null);
  const [grupoSel, setGrupoSel] = useState<string | null>(null);
  // Estado explícito para el toggle DLL: evita depender de valores derivados en render
  // (que pueden quedar desincronizados con los state updates recién aplicados)
  const [dllToggleDisponible, setDllToggleDisponible] = useState(false);

  const firma = FIRMAS_PROP.find((f) => f.id === firmaId) ?? null;

  function aplicarPlan(f: (typeof FIRMAS_PROP)[0], idx: number) {
    const plan = f.planes[idx];
    setBroker(f.nombre);
    setStartingBalance(String(plan.balance));
    setChallengeType(plan.challengeType);
    setAccountType("demo");
    setPhaseTargetPercent(String(plan.objetivoPct));
    setMaxTotalLoss(String(plan.drawdownTotal));
    setUsarDailyLoss(true);
    setMaxDailyLoss(plan.perdidaDiaria !== null ? String(plan.perdidaDiaria) : "");
    setPurchaseCost(String(plan.costo));
    if (!name.trim()) {
      setName(`${f.nombre} ${plan.nombre}`);
    }
    setPlanIdx(idx);
    setPlantillaAplicada(true);
  }

  // ── Helpers para el selector en cascada ────────────────────────────
  // Todos los montos únicos disponibles para la firma seleccionada
  const montosDisponibles: number[] = firma
    ? [...new Set(firma.planes.map((p) => p.balance))].sort((a, b) => a - b)
    : [];

  // Grupos únicos para el monto seleccionado (solo si hay más de uno)
  const gruposDisponibles: string[] = (firma && montoSel !== null)
    ? [...new Set(
        firma.planes
          .filter((p) => p.balance === montoSel && p.grupo)
          .map((p) => p.grupo as string)
      )]
    : [];

  // dllToggleDisponible es estado explícito (ver useState arriba).
  // Se setea en elegirMonto / elegirGrupo al calcular los candidatos con la data
  // correcta en ese momento, evitando que el render use valores derivados potencialmente
  // desactualizados cuando hay batching de state updates.

  function elegirMonto(balance: number) {
    setMontoSel(balance);
    setGrupoSel(null);
    setPlanIdx(null);
    setPlantillaAplicada(false);
    setDllToggleDisponible(false); // reset; se re-evaluará según el grupo elegido
    if (!firma) return;
    const grupos = [...new Set(
      firma.planes
        .filter((p) => p.balance === balance && p.grupo)
        .map((p) => p.grupo as string)
    )];
    if (grupos.length === 0) {
      // Sin grupos — auto-aplicar si no hay elección de DLL
      const candidatos = firma.planes.filter((p) => p.balance === balance);
      const hayDLL = candidatos.some((p) => p.perdidaDiaria !== null);
      const haySinDLL = candidatos.some((p) => p.perdidaDiaria === null);
      if (hayDLL && haySinDLL) {
        setDllToggleDisponible(true);
      } else if (candidatos.length > 0) {
        aplicarPlan(firma, firma.planes.indexOf(candidatos[0]));
      }
    } else if (grupos.length === 1) {
      // Un solo grupo — auto-seleccionar y calcular DLL
      const grupo = grupos[0];
      setGrupoSel(grupo);
      const candidatos = firma.planes.filter(
        (p) => p.balance === balance && p.grupo === grupo
      );
      const hayDLL = candidatos.some((p) => p.perdidaDiaria !== null);
      const haySinDLL = candidatos.some((p) => p.perdidaDiaria === null);
      if (hayDLL && haySinDLL) {
        setDllToggleDisponible(true);
      } else if (candidatos.length > 0) {
        aplicarPlan(firma, firma.planes.indexOf(candidatos[0]));
      }
    }
    // grupos.length > 1: usuario debe elegir grupo primero; dllToggleDisponible queda false
  }

  function elegirGrupo(grupo: string) {
    setGrupoSel(grupo);
    setPlanIdx(null);
    setPlantillaAplicada(false);
    if (!firma || montoSel === null) return;
    const candidatos = firma.planes.filter(
      (p) => p.balance === montoSel && p.grupo === grupo
    );
    const hayDLL = candidatos.some((p) => p.perdidaDiaria !== null);
    const haySinDLL = candidatos.some((p) => p.perdidaDiaria === null);
    if (hayDLL && haySinDLL) {
      // Hay variantes con y sin DLL — mostrar toggle al usuario
      setDllToggleDisponible(true);
    } else {
      // Un solo sabor — auto-aplicar directamente
      setDllToggleDisponible(false);
      if (candidatos.length > 0) {
        const plan = candidatos[0];
        const idx = firma.planes.indexOf(plan);
        aplicarPlan(firma, idx);
      }
    }
  }

  // Aplica el plan que corresponde al monto + grupo + preferencia DLL actual
  function confirmarPlanCascada(conDLL: boolean) {
    if (!firma || montoSel === null) return;
    const candidatos = firma.planes.filter(
      (p) =>
        p.balance === montoSel &&
        (grupoSel === null || !p.grupo || p.grupo === grupoSel) &&
        (dllToggleDisponible ? (conDLL ? p.perdidaDiaria !== null : p.perdidaDiaria === null) : true)
    );
    if (candidatos.length === 0) return;
    const plan = candidatos[0];
    const idx = firma.planes.indexOf(plan);
    aplicarPlan(firma, idx);
    // Solo sobreescribir DLL cuando el usuario eligió explícitamente entre variantes.
    // Si no hay toggle (plan único o firma sin variante), aplicarPlan ya setea el estado correcto.
    if (dllToggleDisponible) {
      setUsarDailyLoss(conDLL);
      if (!conDLL) setMaxDailyLoss("");
    }
  }

  function toggleDailyLoss(checked: boolean) {
    setUsarDailyLoss(checked);
    if (firma && planIdx !== null) {
      const plan = firma.planes[planIdx];
      setMaxDailyLoss(checked && plan.perdidaDiaria !== null ? String(plan.perdidaDiaria) : "");
    }
  }

  function seleccionarFirma(id: string) {
    if (firmaId === id) {
      setFirmaId(null);
      setPlanIdx(null);
      setPlantillaAplicada(false);
      setMontoSel(null);
      setGrupoSel(null);
      setDllToggleDisponible(false);
    } else {
      setFirmaId(id);
      setPlanIdx(null);
      setPlantillaAplicada(false);
      setMontoSel(null);
      setGrupoSel(null);
      setDllToggleDisponible(false);
    }
  }

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
          {/* ── Selector de prop firm ─────────────────────────── */}
          <div className="rounded-lg border border-kb-border-soft bg-kb-bg p-3 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-kb-text-secondary">
              Usar plantilla de prop firm
            </p>

            {/* Grid visual de firmas con ícono + nombre */}
            <div className="grid grid-cols-2 gap-1.5">
              {FIRMAS_PROP.map((f) => {
                const meta = FIRMA_META[f.id] || { abbr: f.nombre.slice(0, 2).toUpperCase(), color: "#6b7280", bg: "rgba(107,114,128,0.15)", domain: "" };
                const sel = firmaId === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => seleccionarFirma(f.id)}
                    className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                      sel
                        ? "border-kb-accent bg-kb-accent/10"
                        : "border-kb-border hover:border-kb-text-secondary"
                    }`}
                  >
                    <FirmaLogo
                      domain={meta.domain}
                      abbr={meta.abbr}
                      color={meta.color}
                      bg={meta.bg}
                      alt={f.nombre}
                    />
                    <span className={`text-[11px] font-medium leading-tight ${sel ? "text-kb-accent" : "text-kb-text-secondary"}`}>
                      {f.nombre}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* ── Selector en cascada ─────────────────────────────── */}
            {firma && (
              <div className="space-y-3">

                {/* Paso 1 — Monto */}
                <div>
                  <p className="mb-1.5 text-[11px] text-kb-text-muted font-medium">
                    1 · Elige el tamaño de cuenta
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {montosDisponibles.map((bal) => (
                      <button
                        key={bal}
                        type="button"
                        onClick={() => elegirMonto(bal)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                          montoSel === bal
                            ? "border-kb-accent bg-kb-accent/10 text-kb-accent"
                            : "border-kb-border text-kb-text hover:border-kb-text-secondary"
                        }`}
                      >
                        ${bal >= 1000 ? `${bal / 1000}K` : bal.toLocaleString()}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Paso 2 — Grupo (solo si hay más de uno para el monto) */}
                {montoSel !== null && gruposDisponibles.length > 1 && (
                  <div>
                    <p className="mb-1.5 text-[11px] text-kb-text-muted font-medium">
                      2 · Tipo de cuenta
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {gruposDisponibles.map((g) => (
                        <button
                          key={g}
                          type="button"
                          onClick={() => elegirGrupo(g)}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                            grupoSel === g
                              ? "border-kb-accent bg-kb-accent/10 text-kb-accent"
                              : "border-kb-border text-kb-text hover:border-kb-text-secondary"
                          }`}
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Paso 2/3 — DLL (solo si aplica y hay monto y grupo elegidos) */}
                {montoSel !== null &&
                  (gruposDisponibles.length <= 1 || grupoSel !== null) &&
                  dllToggleDisponible && (
                  <div>
                    <p className="mb-1.5 text-[11px] text-kb-text-muted font-medium">
                      {gruposDisponibles.length > 1 ? "3" : "2"} · Daily loss limit
                    </p>
                    {plantillaAplicada && planIdx !== null && firma ? (
                      /* Plan aplicado — muestra solo la opción elegida con ✓ (clic para re-elegir) */
                      <button
                        type="button"
                        onClick={() => setPlantillaAplicada(false)}
                        className="rounded-lg border border-kb-gain bg-kb-gain/10 px-3 py-1.5 text-xs font-semibold text-kb-gain"
                      >
                        ✓ {firma.planes[planIdx]?.perdidaDiaria !== null ? "Con DLL" : "Sin DLL"}
                      </button>
                    ) : (
                      /* Pendiente — muestra ambas opciones */
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => confirmarPlanCascada(false)}
                          className="rounded-lg border border-kb-border px-3 py-1.5 text-xs font-semibold text-kb-text transition-colors hover:border-kb-text-secondary"
                        >
                          Sin DLL
                        </button>
                        <button
                          type="button"
                          onClick={() => confirmarPlanCascada(true)}
                          className="rounded-lg border border-kb-border px-3 py-1.5 text-xs font-semibold text-kb-text transition-colors hover:border-kb-text-secondary"
                        >
                          Con DLL
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Botón confirmar cuando monto+grupo ya definen el plan (sin DLL toggle) */}
                {montoSel !== null &&
                  (gruposDisponibles.length <= 1 || grupoSel !== null) &&
                  !dllToggleDisponible && (
                  <button
                    type="button"
                    onClick={() => confirmarPlanCascada(false)}
                    className={`w-full rounded-lg border py-1.5 text-xs font-semibold transition-colors ${
                      plantillaAplicada
                        ? "border-kb-gain bg-kb-gain/10 text-kb-gain"
                        : "border-kb-border bg-kb-bg-soft text-kb-text hover:border-kb-accent hover:text-kb-accent"
                    }`}
                  >
                    {plantillaAplicada ? "✓ Plantilla aplicada" : "Aplicar plan"}
                  </button>
                )}

              </div>
            )}

            {/* Panel de detalles cuando hay un plan seleccionado */}
            {plantillaAplicada && firma && planIdx !== null && (() => {
              const plan = firma.planes[planIdx];
              const ddPct = ((plan.drawdownTotal / plan.balance) * 100).toFixed(1);
              const dlPct = plan.perdidaDiaria
                ? ((plan.perdidaDiaria / plan.balance) * 100).toFixed(1)
                : null;
              return (
                <div className="rounded-lg border border-kb-gain/25 bg-kb-gain/5 p-3 space-y-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-kb-gain">
                    ✓ Plantilla aplicada — {firma.nombre} {plan.nombre}
                  </p>

                  {/* Grid de métricas */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    <div>
                      <p className="text-[10px] text-kb-text-muted">Balance</p>
                      <p className="text-xs font-semibold text-kb-text">${plan.balance.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-kb-text-muted">Objetivo fase</p>
                      <p className="text-xs font-semibold text-kb-text">{plan.objetivoPct}%</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-kb-text-muted">Drawdown total</p>
                      <p className="text-xs font-semibold text-kb-text">${plan.drawdownTotal.toLocaleString()} ({ddPct}%)</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-kb-text-muted">Tipo de challenge</p>
                      <p className="text-xs font-semibold text-kb-text">{CHALLENGE_TYPE_LABELS[plan.challengeType]}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-kb-text-muted">Precio base (sin promo)</p>
                      <p className="text-xs font-semibold text-kb-text">
                        ~${plan.costo} {plan.tipoCosto === "mensual" ? "/ mes" : "(pago único)"}
                      </p>
                    </div>
                  </div>

                  {/* Toggle daily loss */}
                  {plan.perdidaDiaria !== null ? (
                    <div className="flex items-center justify-between rounded-md border border-kb-border-soft bg-kb-bg px-2.5 py-2">
                      <div>
                        <p className="text-[11px] font-medium text-kb-text">Daily loss limit</p>
                        <p className="text-[10px] text-kb-text-muted">
                          ${plan.perdidaDiaria.toLocaleString()} ({dlPct}% del balance)
                        </p>
                      </div>
                      <label className="flex cursor-pointer items-center gap-2 select-none">
                        <input
                          type="checkbox"
                          checked={usarDailyLoss}
                          onChange={(e) => toggleDailyLoss(e.target.checked)}
                          className="h-4 w-4 accent-kb-accent"
                        />
                        <span className={`text-[11px] font-medium ${usarDailyLoss ? "text-kb-gain" : "text-kb-text-muted"}`}>
                          {usarDailyLoss ? "Activado" : "Desactivado"}
                        </span>
                      </label>
                    </div>
                  ) : (
                    <p className="text-[10px] text-kb-text-muted italic">
                      Esta firma no maneja daily loss limit — solo drawdown total.
                    </p>
                  )}

                  <p className="text-[9px] text-kb-text-muted">
                    💡 Precios base (sin código promo). La mayoría de firmas tienen descuentos activos de 20–60% — siempre verifica promos en el sitio oficial antes de comprar.
                  </p>
                </div>
              );
            })()}
          </div>
          {/* ───────────────────────────────────────────────────── */}

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
// MODAL: cuentas archivadas y quemadas (ver, reactivar)
// =====================================================================

function ModalCuentasArchivadas({
  onClose,
  onReactivada,
}: {
  onClose: () => void;
  onReactivada: (cuenta: Account) => void;
}) {
  const [todas, setTodas] = useState<Account[]>([]);
  const [cargando, setCargando] = useState(true);
  const [reactivandoId, setReactivandoId] = useState<string | null>(null);
  const [tab, setTab] = useState<"archivadas" | "quemadas">("archivadas");
  useCerrarConEscape(onClose);

  // Separamos por blown_at: quemadas tienen fecha, archivadas normales no.
  const quemadas = todas.filter((c) => c.blown_at != null);
  const archivadas = todas.filter((c) => c.blown_at == null);

  async function cargarTodas() {
    setCargando(true);
    const { data } = await supabase
      .from("accounts")
      .select("*")
      .eq("is_archived", true)
      .order("created_at", { ascending: true });
    setTodas((data as Account[]) ?? []);
    setCargando(false);
  }

  useEffect(() => {
    cargarTodas();
  }, []);

  async function reactivar(cuenta: Account) {
    setReactivandoId(cuenta.id);
    const { data, error } = await supabase
      .from("accounts")
      .update({ is_archived: false, blown_at: null })
      .eq("id", cuenta.id)
      .select()
      .single();
    setReactivandoId(null);

    if (!error && data) {
      setTodas((prev) => prev.filter((c) => c.id !== cuenta.id));
      onReactivada(data as Account);
    }
  }

  function formatFechaLarga(iso: string) {
    return new Date(iso).toLocaleDateString("es", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  const listaActual = tab === "quemadas" ? quemadas : archivadas;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 overflow-y-auto"
      onClick={(e) => manejarClickFondo(e, onClose)}
    >
      <div className="w-full max-h-[85vh] max-w-md overflow-y-auto rounded-2xl border border-kb-border bg-kb-surface p-7 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">Historial de cuentas</h2>
          <button
            onClick={onClose}
            className="text-kb-text-muted hover:text-kb-text transition"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="mb-4 flex gap-1 rounded-xl border border-kb-border-soft bg-kb-bg p-1">
          <button
            onClick={() => setTab("archivadas")}
            className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors ${
              tab === "archivadas"
                ? "bg-kb-surface text-kb-text shadow-sm"
                : "text-kb-text-secondary hover:text-kb-text"
            }`}
          >
            🗂 Archivadas {!cargando && archivadas.length > 0 && `(${archivadas.length})`}
          </button>
          <button
            onClick={() => setTab("quemadas")}
            className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors ${
              tab === "quemadas"
                ? "bg-kb-surface text-orange-400 shadow-sm"
                : "text-kb-text-secondary hover:text-orange-400"
            }`}
          >
            🔥 Quemadas {!cargando && quemadas.length > 0 && `(${quemadas.length})`}
          </button>
        </div>

        {cargando ? (
          <div className="space-y-2 py-2">
            <SkeletonBloque className="h-10 w-full" />
            <SkeletonBloque className="h-10 w-full" />
          </div>
        ) : listaActual.length === 0 ? (
          <p className="py-8 text-center text-sm text-kb-text-secondary">
            {tab === "quemadas"
              ? "No tenés ninguna cuenta quemada registrada."
              : "No tenés ninguna cuenta archivada."}
          </p>
        ) : (
          <div className="space-y-2">
            {listaActual.map((c) => (
              <div
                key={c.id}
                className={`rounded-xl border px-4 py-3 ${
                  c.blown_at
                    ? "border-orange-500/30 bg-orange-500/5"
                    : "border-kb-border-soft bg-kb-bg"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {c.blown_at && (
                        <span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-400">
                          🔥 QUEMADA
                        </span>
                      )}
                      {c.phase !== "no_aplica" && (
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          c.phase === "financiada"
                            ? "bg-kb-gain/15 text-kb-gain"
                            : "bg-kb-accent/10 text-kb-accent"
                        }`}>
                          {c.phase === "financiada" ? "✓ Fondeada" : PHASE_LABELS[c.phase]}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm font-semibold text-kb-text">{c.name}</p>
                    <p className="text-xs text-kb-text-muted">
                      {c.broker ? `${c.broker} · ` : ""}
                      {c.currency} {c.starting_balance.toLocaleString("es")}
                    </p>
                    {c.blown_at && (
                      <p className="mt-0.5 text-[11px] text-orange-400/80">
                        Quemada el {formatFechaLarga(c.blown_at)}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => reactivar(c)}
                    disabled={reactivandoId === c.id}
                    className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                      c.blown_at
                        ? "border-orange-500/40 text-orange-400 hover:bg-orange-500/10"
                        : "border-kb-accent/40 text-kb-accent hover:bg-kb-accent/10"
                    }`}
                  >
                    {reactivandoId === c.id ? "Reactivando…" : "Reactivar"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "quemadas" && !cargando && quemadas.length > 0 && (
          <p className="mt-4 text-center text-[11px] text-kb-text-muted">
            Al reactivar una cuenta quemada se elimina la marca de quemada y vuelve al dashboard activo.
          </p>
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
        {puntoHover && hoverIndex !== null && (() => {
          const pctX = (coordX(hoverIndex) / ancho) * 100;
          // Clamp tooltip so it doesn't overflow left or right edge
          const tooltipWidth = 140; // min-w-[140px]
          const containerWidth = contenedorRef.current?.offsetWidth ?? ancho;
          const offsetPx = (pctX / 100) * containerWidth;
          const clampedLeft = Math.min(
            Math.max(offsetPx, tooltipWidth / 2),
            containerWidth - tooltipWidth / 2
          );
          const translateX = offsetPx - clampedLeft;
          return (
          <div
            className="pointer-events-none absolute z-10 min-w-[140px] -translate-y-[calc(100%+12px)] rounded-lg border border-kb-border bg-kb-surface-raised px-3 py-2 text-xs shadow-xl"
            style={{
              left: `${(clampedLeft / containerWidth) * 100}%`,
              top: `${(coordY(puntoHover.acumulado) / alto) * 100}%`,
              transform: `translateX(-50%) translateX(${translateX}px) translateY(calc(-100% - 12px))`,
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
          );
        })()}
      </div>
    </section>
  );
}

// =====================================================================
// PANEL DE MÉTRICAS PRINCIPAL — donut de win rate + P&L + barra de
// ganancia/pérdida promedio + extremos (estilo TradeLog)
// =====================================================================

function DonutWinRate({ winRate, totalTrades }: { winRate: number; totalTrades: number }) {
  // Medidor de arco semicircular (tipo velocímetro) en vez del donut
  // circular completo que usan casi todas las journals de trading — es
  // el mismo dato, pero con una forma que no se parece al molde típico.
  const ancho = 168;
  const alto = 96;
  const radio = 72;
  const grosor = 14;
  const cx = ancho / 2;
  const cy = alto - 8;
  const largoArco = Math.PI * radio; // longitud de un semicírculo
  const porcionGanadora = (Math.min(Math.max(winRate, 0), 100) / 100) * largoArco;

  return (
    <div className="relative flex w-[168px] shrink-0 flex-col items-center">
      <svg viewBox={`0 0 ${ancho} ${alto}`} className="w-full">
        <path
          d={`M ${cx - radio} ${cy} A ${radio} ${radio} 0 0 1 ${cx + radio} ${cy}`}
          fill="none"
          stroke="var(--kb-loss)"
          strokeWidth={grosor}
          strokeLinecap="round"
          opacity="0.3"
        />
        <path
          d={`M ${cx - radio} ${cy} A ${radio} ${radio} 0 0 1 ${cx + radio} ${cy}`}
          fill="none"
          stroke="var(--kb-gain)"
          strokeWidth={grosor}
          strokeLinecap="round"
          strokeDasharray={`${porcionGanadora} ${largoArco}`}
        />
      </svg>
      <div className="absolute bottom-1.5 flex flex-col items-center">
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

// =====================================================================
// CONSEJO DEL DÍA — un mensaje distinto cada día (psicología de trading,
// disciplina, gestión de riesgo, y algunos versículos sobre la
// paciencia). Rota según la fecha, así que todos ven el mismo mensaje
// el mismo día y no se repite hasta que da toda la vuelta a la lista.
// =====================================================================

interface ConsejoDia {
  texto: string;
  fuente: string;
  categoria: "psicologia" | "biblico";
}

const BANCO_DE_CONSEJOS: ConsejoDia[] = [
  { texto: "La paciencia no es esperar sin hacer nada — es sostener tu plan aunque el mercado te tiente a romperlo.", fuente: "Psicología de trading", categoria: "psicologia" },
  { texto: "Un trade perdedor que respetó tu plan es una victoria. Uno ganador que rompió tus reglas es una trampa.", fuente: "Disciplina", categoria: "psicologia" },
  { texto: "El mercado no te debe nada hoy. Tu única obligación es seguir tu proceso, no perseguir un resultado.", fuente: "Psicología de trading", categoria: "psicologia" },
  { texto: "El miedo a perderte una operación (FOMO) siempre sale más caro que la operación que te perdiste.", fuente: "Gestión de riesgo", categoria: "psicologia" },
  { texto: "No existe la racha ganadora infinita. Protegé el capital primero; las ganancias vienen solas después.", fuente: "Gestión de riesgo", categoria: "psicologia" },
  { texto: "Cada vez que revisás el gráfico cada 30 segundos, no estás operando — estás ansioso.", fuente: "Psicología de trading", categoria: "psicologia" },
  { texto: "La paciencia produce firmeza; y la firmeza, resultado perfecto, para que seáis perfectos y cabales, sin que os falte cosa alguna.", fuente: "Santiago 1:4", categoria: "biblico" },
  { texto: "El resultado de una sola operación no define quién sos como trader — tu proceso repetido sí.", fuente: "Psicología de trading", categoria: "psicologia" },
  { texto: "Vengarte del mercado después de una pérdida es la forma más rápida de convertir una pérdida chica en una grande.", fuente: "Disciplina", categoria: "psicologia" },
  { texto: "Mejor es el sufrido que el valiente; y el que domina su espíritu, que el que toma una ciudad.", fuente: "Proverbios 16:32", categoria: "biblico" },
  { texto: "Si tu stop loss te incomoda antes de entrar, el problema no es el stop — es el tamaño de tu posición.", fuente: "Gestión de riesgo", categoria: "psicologia" },
  { texto: "No sabés cuál trade va a ser el ganador. Por eso seguís el mismo proceso en todos, sin excepciones.", fuente: "Disciplina", categoria: "psicologia" },
  { texto: "No nos cansemos, pues, de hacer bien; porque a su tiempo segaremos, si no desmayamos.", fuente: "Gálatas 6:9", categoria: "biblico" },
  { texto: "Cerrar una operación por aburrimiento no es una estrategia de salida — es impaciencia disfrazada.", fuente: "Psicología de trading", categoria: "psicologia" },
  { texto: "Tu peor día de trading nunca debería poder borrar tu mejor mes.", fuente: "Gestión de riesgo", categoria: "psicologia" },
  { texto: "Y no solo esto, sino que también nos gloriamos en las tribulaciones, sabiendo que la tribulación produce paciencia.", fuente: "Romanos 5:3", categoria: "biblico" },
  { texto: "Escribir por qué entraste a un trade, antes de entrar, es la diferencia entre un plan y una corazonada.", fuente: "Psicología de trading", categoria: "psicologia" },
  { texto: "No hay una sola operación tan importante como para justificar romper tu regla de riesgo.", fuente: "Disciplina", categoria: "psicologia" },
  { texto: "Todo tiene su tiempo, y todo lo que se quiere debajo del cielo tiene su hora.", fuente: "Eclesiastés 3:1", categoria: "biblico" },
  { texto: "Copiar la operación de otro trader sin entender el motivo no es aprender — es apostar con otro nombre.", fuente: "Psicología de trading", categoria: "psicologia" },
  { texto: "Un mal día no arruina un buen sistema. Un buen día no arregla uno malo.", fuente: "Gestión de riesgo", categoria: "psicologia" },
  { texto: "Guarda silencio ante Jehová, y espera en él. No te alteres con motivo del que prospera en su camino.", fuente: "Salmos 37:7", categoria: "biblico" },
  { texto: "El overtrading casi nunca es sobre el mercado. Es sobre no saber estar quieto con vos mismo.", fuente: "Psicología de trading", categoria: "psicologia" },
  { texto: "Tu edge no está en predecir el mercado. Está en gestionar bien lo que no podés predecir.", fuente: "Gestión de riesgo", categoria: "psicologia" },
  { texto: "Bienaventurado el varón que soporta la tentación; porque cuando haya resistido la prueba, recibirá la corona de vida.", fuente: "Santiago 1:12", categoria: "biblico" },
  { texto: "Si necesitás recuperar rápido lo que perdiste, ya estás operando con la emoción equivocada.", fuente: "Psicología de trading", categoria: "psicologia" },
  { texto: "El trading rentable es aburrido la mayoría de los días. Si buscás emoción, buscá otro hobby.", fuente: "Disciplina", categoria: "psicologia" },
  { texto: "Mas los que esperan a Jehová tendrán nuevas fuerzas; levantarán alas como las águilas; correrán, y no se cansarán.", fuente: "Isaías 40:31", categoria: "biblico" },
  { texto: "Nadie tiene un año perfecto. Los traders que duran son los que sobreviven a los meses malos sin volarse la cuenta.", fuente: "Gestión de riesgo", categoria: "psicologia" },
  { texto: "La confianza real no viene de ganar el último trade — viene de saber que tu proceso es sólido, gane o pierda.", fuente: "Psicología de trading", categoria: "psicologia" },

  // ---- Tanda 2: para que el ciclo no se repita cada 30 días ----
  { texto: "Operar más no es lo mismo que operar mejor. La calidad de tus entradas importa más que la cantidad.", fuente: "Disciplina", categoria: "psicologia" },
  { texto: "El trading no premia a quien tiene razón más seguido. Premia a quien pierde poco cuando se equivoca.", fuente: "Gestión de riesgo", categoria: "psicologia" },
  { texto: "Si tenés que revisar tu cuenta cada 5 minutos, tu tamaño de posición es más grande de lo que tu psicología aguanta.", fuente: "Psicología de trading", categoria: "psicologia" },
  { texto: "Todo lo puedo en Cristo que me fortalece.", fuente: "Filipenses 4:13", categoria: "biblico" },
  { texto: "Un journal que solo lees cuando ganás no te sirve. El valor está en revisar también los días malos.", fuente: "Disciplina", categoria: "psicologia" },
  { texto: "El mercado te va a dar miles de oportunidades más. Nunca es la última chance — solo se siente así.", fuente: "Psicología de trading", categoria: "psicologia" },
  { texto: "Encomienda a Jehová tu camino, y confía en él; y él hará.", fuente: "Salmos 37:5", categoria: "biblico" },
  { texto: "Cambiar de estrategia después de 3 pérdidas seguidas casi siempre es impaciencia, no análisis.", fuente: "Disciplina", categoria: "psicologia" },
  { texto: "Tu diario de trading no es para justificarte — es para encontrar el patrón que te está costando plata.", fuente: "Psicología de trading", categoria: "psicologia" },
  { texto: "Nadie construyó una cuenta sólida en una semana. Pensá en meses, no en operaciones sueltas.", fuente: "Motivación", categoria: "psicologia" },
  { texto: "Panal de miel son los dichos suaves; suavidad al alma y medicina para los huesos.", fuente: "Proverbios 16:24", categoria: "biblico" },
  { texto: "Si necesitás que el próximo trade salga bien para sentirte tranquilo, ya perdiste el control emocional.", fuente: "Psicología de trading", categoria: "psicologia" },
  { texto: "Operar cansado, enojado o distraído cuesta más caro que no operar ese día.", fuente: "Gestión de riesgo", categoria: "psicologia" },
  { texto: "El hombre sabio teme, y se aparta del mal; mas el insensato se muestra insolente y confiado.", fuente: "Proverbios 14:16", categoria: "biblico" },
  { texto: "No sos tu peor trade. Tampoco sos tu mejor trade. Sos el promedio de cientos de decisiones repetidas.", fuente: "Psicología de trading", categoria: "psicologia" },
  { texto: "Bajar el tamaño de tu posición cuando estás en racha perdedora no es debilidad — es supervivencia.", fuente: "Gestión de riesgo", categoria: "psicologia" },
  { texto: "El que confía en su propio corazón es necio; mas el que camina en sabiduría será librado.", fuente: "Proverbios 28:26", categoria: "biblico" },
  { texto: "Cada operación es un experimento con tu sistema, no una prueba de tu valor personal.", fuente: "Psicología de trading", categoria: "psicologia" },
  { texto: "El día que dejes de sentir algo al perder, revisá si te importa demasiado poco — no si te volviste 'profesional'.", fuente: "Psicología de trading", categoria: "psicologia" },
  { texto: "Sed sobrios, y velad; porque vuestro adversario el diablo, como león rugiente, anda alrededor buscando a quién devorar.", fuente: "1 Pedro 5:8", categoria: "biblico" },
  { texto: "El apalancamiento no crea ventaja — solo agranda lo que ya estaba mal en tu plan.", fuente: "Gestión de riesgo", categoria: "psicologia" },
  { texto: "Antes de abrir el gráfico hoy, preguntate: ¿estoy buscando una oportunidad, o estoy buscando acción?", fuente: "Psicología de trading", categoria: "psicologia" },
  { texto: "Encomienda a Jehová tus obras, y tus pensamientos serán afirmados.", fuente: "Proverbios 16:3", categoria: "biblico" },
  { texto: "Ganar plata rápido casi nunca coincide con ganar plata de forma sostenible. Elegí una de las dos.", fuente: "Motivación", categoria: "psicologia" },
  { texto: "Tu peor enemigo en el trading no es el mercado — es la versión de vos que quiere razón ya mismo.", fuente: "Psicología de trading", categoria: "psicologia" },
  { texto: "La disciplina que mantenés cuando nadie te está mirando es la que realmente define tus resultados.", fuente: "Disciplina", categoria: "psicologia" },
  { texto: "El corazón del hombre piensa su camino; mas Jehová endereza sus pasos.", fuente: "Proverbios 16:9", categoria: "biblico" },
  { texto: "Un plan de trading que nunca revisás no es un plan — es un recuerdo de lo que pensabas hace meses.", fuente: "Disciplina", categoria: "psicologia" },
  { texto: "El tamaño de tu ganancia no importa si no podés explicar por qué ganaste.", fuente: "Psicología de trading", categoria: "psicologia" },
  { texto: "Gozaos en la esperanza; sufridos en la tribulación; constantes en la oración.", fuente: "Romanos 12:12", categoria: "biblico" },
  { texto: "Si operás para probarle algo a alguien, ya elegiste al público equivocado — el mercado no te está mirando.", fuente: "Psicología de trading", categoria: "psicologia" },
  { texto: "Cerrar en breakeven después de estar en ganancia no es fracaso — es respetar tu plan de salida.", fuente: "Gestión de riesgo", categoria: "psicologia" },
  { texto: "Practica la justicia, ama la misericordia, y humíllate ante tu Dios.", fuente: "Miqueas 6:8", categoria: "biblico" },
  { texto: "El burnout de trading existe. Un día sin operar puede ser la decisión más rentable de la semana.", fuente: "Psicología de trading", categoria: "psicologia" },
  { texto: "No compares tu curva de equity con la de otro trader — no conocés su capital, su riesgo real ni sus pérdidas ocultas.", fuente: "Motivación", categoria: "psicologia" },
  { texto: "Someteos, pues, a Dios; resistid al diablo, y huirá de vosotros.", fuente: "Santiago 4:7", categoria: "biblico" },
  { texto: "La mejor operación de la semana puede ser la que decidiste no tomar.", fuente: "Disciplina", categoria: "psicologia" },
  { texto: "Si tu razón para entrar fue 'se ve que va para arriba', esa no es una razón — es una esperanza.", fuente: "Psicología de trading", categoria: "psicologia" },
  { texto: "Regocijaos en la esperanza, sed pacientes en la tribulación.", fuente: "Romanos 12:12", categoria: "biblico" },
  { texto: "Tu stop loss no es un insulto a tu análisis. Es el precio de estar equivocado sin que duela demasiado.", fuente: "Gestión de riesgo", categoria: "psicologia" },
  { texto: "Cuantas más pantallas mires al mismo tiempo, menos control real tenés sobre lo que estás haciendo.", fuente: "Psicología de trading", categoria: "psicologia" },
  { texto: "Danos hoy nuestro pan cotidiano — no el de todo el mes en un solo día.", fuente: "Mateo 6:11 (adaptado al trading)", categoria: "biblico" },
  { texto: "Los traders que sobreviven diez años no son los más brillantes — son los más consistentes.", fuente: "Motivación", categoria: "psicologia" },
  { texto: "Cada vez que rompés tu regla de riesgo y sale bien, reforzás el hábito que algún día te va a explotar la cuenta.", fuente: "Gestión de riesgo", categoria: "psicologia" },
  { texto: "El principio de la sabiduría es el temor de Jehová; buen entendimiento tienen todos los que practican sus mandamientos.", fuente: "Salmos 111:10", categoria: "biblico" },
  { texto: "No necesitás tener razón sobre el mercado. Necesitás tener razón sobre cuándo estar equivocado te sale barato.", fuente: "Psicología de trading", categoria: "psicologia" },
  { texto: "El aburrimiento entre operaciones es una señal de que tu sistema funciona, no de que algo falta.", fuente: "Disciplina", categoria: "psicologia" },
  { texto: "Andad, pues, como es digno de la vocación con que fuisteis llamados, con toda humildad y mansedumbre, soportándoos con paciencia los unos a los otros en amor.", fuente: "Efesios 4:1-2", categoria: "biblico" },
  { texto: "Una racha ganadora no te hace mejor trader. Solo te hace un trader con suerte reciente hasta que se demuestre lo contrario.", fuente: "Psicología de trading", categoria: "psicologia" },
  { texto: "El mejor momento para revisar tu plan de riesgo es después de una racha ganadora, no después de una perdedora.", fuente: "Gestión de riesgo", categoria: "psicologia" },
  { texto: "No os conforméis a este siglo, sino transformaos por medio de la renovación de vuestro entendimiento.", fuente: "Romanos 12:2", categoria: "biblico" },
  { texto: "El objetivo de hoy no es ganar plata. Es ejecutar tu plan sin importar el resultado.", fuente: "Disciplina", categoria: "psicologia" },
  { texto: "Cuando dudes entre entrar o esperar, esperar casi siempre es la decisión más profesional.", fuente: "Psicología de trading", categoria: "psicologia" },
  { texto: "Mejor es lo poco con justicia, que la muchedumbre de frutos sin derecho.", fuente: "Proverbios 16:8", categoria: "biblico" },
  { texto: "Nadie te va a aplaudir por respetar tu stop loss. Pero es lo que te va a permitir seguir operando el año que viene.", fuente: "Gestión de riesgo", categoria: "psicologia" },
  { texto: "El trading solitario necesita autodisciplina extra, porque nadie más te va a frenar cuando estés por romper tu regla.", fuente: "Psicología de trading", categoria: "psicologia" },
  { texto: "Velad y orad, para que no entréis en tentación; el espíritu a la verdad está dispuesto, pero la carne es débil.", fuente: "Mateo 26:41", categoria: "biblico" },
  { texto: "Un buen trader pierde bien. Un trader excelente además aprende algo específico de cada pérdida.", fuente: "Motivación", categoria: "psicologia" },
];

/** Elige el consejo del día según la fecha (mismo día = mismo consejo para todos, y no se repite hasta dar toda la vuelta a la lista). */
function consejoDeHoy(): ConsejoDia {
  const hoy = new Date();
  const inicioDeAño = new Date(hoy.getFullYear(), 0, 0);
  const diferenciaMs = hoy.getTime() - inicioDeAño.getTime();
  const diaDelAño = Math.floor(diferenciaMs / (1000 * 60 * 60 * 24));
  return BANCO_DE_CONSEJOS[diaDelAño % BANCO_DE_CONSEJOS.length];
}

function ConsejoDelDiaWidget() {
  const [consejo, setConsejo] = useState<ConsejoDia | null>(null);

  useEffect(() => {
    setConsejo(consejoDeHoy());
  }, []);

  if (!consejo) {
    return (
      <section className="rounded-xl border border-kb-border bg-kb-surface p-4">
        <SkeletonBloque className="h-4 w-40 mb-3" />
        <SkeletonBloque className="h-10 w-full" />
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-kb-border bg-gradient-to-br from-kb-accent/10 via-kb-surface to-kb-surface p-4">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-kb-accent">
        {consejo.categoria === "biblico" ? "📖" : "💭"} Consejo del día
      </p>
      <p className="font-display text-sm leading-relaxed text-kb-text">
        &quot;{consejo.texto}&quot;
      </p>
      <p className="mt-2 text-[11px] text-kb-text-muted">— {consejo.fuente}</p>
    </section>
  );
}

// =====================================================================
// PUNTAJE KEBOTRADER — un solo número (0-100) que resume tu salud de
// trading, inspirado en lo que journals como TradeZella/TraderSync
// llaman "trading score". A diferencia de un widget de noticias
// externo, esto se calcula 100% con tus propios datos — no depende de
// ningún servicio de terceros, así que nunca se rompe ni tarda en
// cargar, y es información que de verdad podés accionar.
//
// Se arma con 4 componentes en partes iguales (25% cada uno):
//  · Win rate (con techo en 60% — no hace falta más para un puntaje pleno)
//  · Profit factor (con techo en 2.0)
//  · Disciplina (% de trades sin un error registrado)
//  · Consistencia (qué tan chico fue tu peor drawdown en % desde el pico)
// =====================================================================

interface DesgloseKeboScore {
  etiqueta: string;
  puntaje: number;
}

function calcularKeboScore(trades: Trade[]): { puntaje: number; desglose: DesgloseKeboScore[] } | null {
  const cerrados = trades.filter((t) => t.status === "closed" && t.realized_pnl !== null);
  if (cerrados.length < 5) return null;

  const ganadores = cerrados.filter((t) => (t.realized_pnl ?? 0) > 0);
  const winRate = ganadores.length / cerrados.length;
  const gananciaTotal = ganadores.reduce((a, t) => a + (t.realized_pnl ?? 0), 0);
  const perdidaTotal = Math.abs(
    cerrados.filter((t) => (t.realized_pnl ?? 0) < 0).reduce((a, t) => a + (t.realized_pnl ?? 0), 0)
  );
  const profitFactor = perdidaTotal > 0 ? gananciaTotal / perdidaTotal : gananciaTotal > 0 ? 2 : 0;

  const sinError = cerrados.filter((t) => {
    const tieneErrores = t.mistakes && t.mistakes.length > 0;
    const tieneErrorViejo = t.mistake && t.mistake !== "ninguno";
    return !tieneErrores && !tieneErrorViejo;
  }).length;
  const puntajeDisciplina = (sinError / cerrados.length) * 100;

  const ordenados = [...cerrados].sort((a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime());
  let acumulado = 0;
  let pico = 0;
  let peorCaidaPorcentaje = 0;
  ordenados.forEach((t) => {
    acumulado += t.realized_pnl ?? 0;
    pico = Math.max(pico, acumulado);
    if (pico > 0) peorCaidaPorcentaje = Math.max(peorCaidaPorcentaje, ((pico - acumulado) / pico) * 100);
  });

  const puntajeWinRate = Math.min(winRate / 0.6, 1) * 100;
  const puntajePF = Math.min(profitFactor / 2, 1) * 100;
  const puntajeConsistencia = Math.max(0, 100 - peorCaidaPorcentaje * 2);

  const puntaje = Math.round((puntajeWinRate + puntajePF + puntajeDisciplina + puntajeConsistencia) / 4);

  return {
    puntaje,
    desglose: [
      { etiqueta: "Win rate", puntaje: Math.round(puntajeWinRate) },
      { etiqueta: "Profit factor", puntaje: Math.round(puntajePF) },
      { etiqueta: "Disciplina", puntaje: Math.round(puntajeDisciplina) },
      { etiqueta: "Consistencia", puntaje: Math.round(puntajeConsistencia) },
    ],
  };
}

function KeboScoreWidget({ trades }: { trades: Trade[] }) {
  const resultado = useMemo(() => calcularKeboScore(trades), [trades]);
  const puntajeAnimado = useNumeroAnimado(resultado?.puntaje ?? 0);

  const colorPuntaje = (p: number) => (p >= 70 ? "text-kb-gain" : p >= 40 ? "text-kb-accent" : "text-kb-loss");
  const colorBarra = (p: number) => (p >= 70 ? "bg-kb-gain" : p >= 40 ? "bg-kb-accent" : "bg-kb-loss");

  return (
    <section className="rounded-xl border border-kb-border bg-kb-surface p-4">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-kb-text-secondary">
        🎯 Puntaje KeboTrader
      </p>

      {!resultado ? (
        <div className="py-4 text-center">
          <p className="text-xs text-kb-text-secondary">
            Cerrá al menos 5 operaciones para desbloquear tu puntaje.
          </p>
          <p className="mt-1 font-mono text-xs font-semibold text-kb-text-muted">
            {trades.filter((t) => t.status === "closed" && t.realized_pnl !== null).length} / 5 operaciones cerradas
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <p className={`font-mono text-4xl font-bold ${colorPuntaje(resultado.puntaje)}`}>
              {Math.round(puntajeAnimado)}
              <span className="text-base text-kb-text-muted">/100</span>
            </p>
            <div className="flex-1 space-y-1.5">
              {resultado.desglose.map((d) => (
                <div key={d.etiqueta}>
                  <div className="mb-0.5 flex items-center justify-between text-[10px] text-kb-text-muted">
                    <span>{d.etiqueta}</span>
                    <span>{d.puntaje}</span>
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-kb-border">
                    <div className={`h-full ${colorBarra(d.puntaje)}`} style={{ width: `${d.puntaje}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-3 text-[10px] text-kb-text-muted">
            Combina win rate, profit factor, disciplina (trades sin errores marcados) y qué tan
            controlado fue tu peor drawdown. Se recalcula solo con cada operación nueva.
          </p>
        </>
      )}
    </section>
  );
}

// =====================================================================
// COMPARACIÓN MENSUAL — este mes vs. el mes anterior, para ver de un
// vistazo si estás mejorando o empeorando en el tiempo.
// =====================================================================

function ComparacionMensualWidget({ trades }: { trades: Trade[] }) {
  const { actual, anterior } = useMemo(() => {
    const ahora = new Date();
    const mesActual = ahora.getMonth();
    const añoActual = ahora.getFullYear();
    const fechaMesAnterior = new Date(añoActual, mesActual - 1, 1);

    let pnlActual = 0;
    let pnlAnterior = 0;
    trades
      .filter((t) => t.status === "closed" && t.realized_pnl !== null)
      .forEach((t) => {
        const fecha = new Date(t.entry_time);
        if (fecha.getFullYear() === añoActual && fecha.getMonth() === mesActual) {
          pnlActual += t.realized_pnl ?? 0;
        } else if (
          fecha.getFullYear() === fechaMesAnterior.getFullYear() &&
          fecha.getMonth() === fechaMesAnterior.getMonth()
        ) {
          pnlAnterior += t.realized_pnl ?? 0;
        }
      });
    return { actual: pnlActual, anterior: pnlAnterior };
  }, [trades]);

  const diferencia = actual - anterior;
  const mejorando = diferencia >= 0;

  return (
    <section className="rounded-xl border border-kb-border bg-kb-surface p-4">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-kb-text-secondary">
        📊 Este mes vs. el anterior
      </p>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] text-kb-text-muted">Este mes</p>
          <p className={`font-mono text-lg font-bold ${actual >= 0 ? "text-kb-gain" : "text-kb-loss"}`}>
            {formatCurrency(actual)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-kb-text-muted">Mes anterior</p>
          <p className="font-mono text-sm text-kb-text-secondary">{formatCurrency(anterior)}</p>
        </div>
      </div>
      <p className={`mt-2.5 text-xs font-medium ${mejorando ? "text-kb-gain" : "text-kb-loss"}`}>
        {mejorando ? "▲" : "▼"} {formatCurrency(Math.abs(diferencia))} {mejorando ? "mejor" : "peor"} que el mes pasado
      </p>
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
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(ruta, 3600);
      if (activo) setUrl(error ? null : (data?.signedUrl ?? null));
    }
    cargar();
    return () => {
      activo = false;
    };
  }, [bucket, path]);

  // null puede ser: cargando aún, o error al obtener URL firmada.
  // En ambos casos mostramos skeleton; si fue error, quedará así (no hay retry).
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
      const { data, error } = await supabase.storage.from("trade-evidence").createSignedUrl(rutaLimpia, 3600);
      if (activo) setUrlFirmada(error ? null : (data?.signedUrl ?? null));
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
  soloLectura = false,
}: {
  trades: Trade[];
  diaSeleccionado: string;
  onSeleccionarDia: (clave: string) => void;
  onAbrirDia: (clave: string, tradesDelDia: Trade[]) => void;
  soloLectura?: boolean;
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
  // En modo soloLectura (cuando no hay una cuenta seleccionada) solo
  // permitimos ver trades existentes, no abrir el form de registro.
  function manejarClickDia(clave: string) {
    const tradesDelDia = trades.filter((t) => fechaKeyLocal(t.entry_time) === clave);
    if (soloLectura && tradesDelDia.length === 0) return; // nada que ver
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
                onClick={() => {
                  const hoy = new Date();
                  setMesActual({ year: hoy.getFullYear(), month: hoy.getMonth() });
                }}
                aria-label="Mes actual"
                className="rounded-lg border border-kb-border px-2.5 py-1 text-xs font-medium text-kb-text-secondary hover:border-kb-accent hover:text-kb-accent transition-colors"
              >
                Hoy
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

/** Devuelve el valor más repetido de una lista (la "moda") — se usa para sugerir la sesión/estrategia que más usás, en vez de arrancar siempre en blanco. */
/**
 * Hora de apertura típica de cada sesión, en hora LOCAL de esa plaza
 * (no UTC) — así el horario de verano/invierno se resuelve solo, sin
 * tener que ajustar nada a mano dos veces al año. Se usa para
 * autocompletar la hora de entrada cuando elegís una sesión en el
 * formulario de carga rápida.
 */
const HORA_APERTURA_SESION: Record<TradingSession, { zona: string; hora: number; minuto: number }> = {
  asia: { zona: "Asia/Tokyo", hora: 9, minuto: 0 },
  londres: { zona: "Europe/London", hora: 8, minuto: 0 },
  nueva_york: { zona: "America/New_York", hora: 8, minuto: 0 },
  apertura_ny: { zona: "America/New_York", hora: 9, minuto: 30 },
};

/** Diferencia en minutos entre una zona horaria y UTC, en este momento (contempla el horario de verano automáticamente). */
function obtenerOffsetMinutos(zona: string): number {
  const ahora = new Date();
  const opciones: Intl.DateTimeFormatOptions = {
    timeZone: undefined,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  const partesUTC = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { ...opciones, timeZone: "UTC" }).formatToParts(ahora).map((p) => [p.type, p.value])
  );
  const partesZona = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { ...opciones, timeZone: zona }).formatToParts(ahora).map((p) => [p.type, p.value])
  );
  const comoUTC = Date.UTC(+partesUTC.year, +partesUTC.month - 1, +partesUTC.day, +partesUTC.hour, +partesUTC.minute);
  const comoZona = Date.UTC(+partesZona.year, +partesZona.month - 1, +partesZona.day, +partesZona.hour, +partesZona.minute);
  return (comoZona - comoUTC) / 60000;
}

/** Devuelve "HH:MM" — la hora de apertura de la sesión elegida, convertida al huso horario de TU navegador, para hoy. */
function horaAperturaSesionLocal(sesion: TradingSession): string {
  const { zona, hora, minuto } = HORA_APERTURA_SESION[sesion];
  const offsetMin = obtenerOffsetMinutos(zona);
  const ahora = new Date();
  const partesHoyEnZona = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(ahora)
      .map((p) => [p.type, p.value])
  );
  const instanteUTC =
    Date.UTC(+partesHoyEnZona.year, +partesHoyEnZona.month - 1, +partesHoyEnZona.day, hora, minuto) - offsetMin * 60000;
  const fechaResultado = new Date(instanteUTC);
  // getHours()/getMinutes() devuelven la hora en TU navegador automáticamente.
  return `${String(fechaResultado.getHours()).padStart(2, "0")}:${String(fechaResultado.getMinutes()).padStart(2, "0")}`;
}

function valorMasFrecuente<T>(valores: T[]): T | null {
  if (valores.length === 0) return null;
  const conteo = new Map<T, number>();
  valores.forEach((v) => conteo.set(v, (conteo.get(v) ?? 0) + 1));
  let mejor: T | null = null;
  let mejorConteo = 0;
  conteo.forEach((c, v) => {
    if (c > mejorConteo) {
      mejorConteo = c;
      mejor = v;
    }
  });
  return mejor;
}

interface PlantillaTrade {
  nombre: string;
  symbol: string;
  instrumentType: InstrumentType;
  side: TradeSide;
  session: TradingSession | "";
  strategyId: string;
}

const CLAVE_PLANTILLAS = "kebotrader_plantillas_trade";

function cargarPlantillas(): PlantillaTrade[] {
  if (typeof window === "undefined") return [];
  try {
    const guardado = window.localStorage.getItem(CLAVE_PLANTILLAS);
    return guardado ? JSON.parse(guardado) : [];
  } catch {
    return [];
  }
}

function guardarPlantillas(plantillas: PlantillaTrade[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CLAVE_PLANTILLAS, JSON.stringify(plantillas));
}

// =====================================================================
// CALCULADORA DE TAMAÑO DE POSICIÓN — resuelve el cálculo ANTES de
// entrar al trade: "si arriesgo $X y mi stop está a Y puntos, ¿cuántos
// contratos/lotes compro?". No se guarda en la base, es una
// herramienta de apoyo que solo rellena los campos del formulario.
// =====================================================================

function CalculadoraTamañoPosicion({
  onUsarCantidad,
  onUsarRiesgo,
}: {
  onUsarCantidad: (valor: string) => void;
  onUsarRiesgo: (valor: string) => void;
}) {
  const [abierta, setAbierta] = useState(false);
  const [riesgoDolares, setRiesgoDolares] = useState("");
  const [distanciaStop, setDistanciaStop] = useState("");
  const [valorPorPunto, setValorPorPunto] = useState("");

  const riesgo = parseFloat(riesgoDolares);
  const distancia = parseFloat(distanciaStop);
  const valorPunto = parseFloat(valorPorPunto);
  const cantidadSugerida =
    !Number.isNaN(riesgo) && !Number.isNaN(distancia) && !Number.isNaN(valorPunto) && distancia > 0 && valorPunto > 0
      ? riesgo / (distancia * valorPunto)
      : null;

  return (
    <div className="mb-4 rounded-lg border border-kb-border-soft bg-kb-bg">
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left"
      >
        <span className="text-xs font-semibold text-kb-accent">🧮 Calculadora de tamaño de posición</span>
        <span className={`text-kb-text-muted transition-transform ${abierta ? "rotate-180" : ""}`}>⌄</span>
      </button>
      {abierta && (
        <div className="space-y-3 border-t border-kb-border-soft px-3 py-3">
          <p className="text-[11px] text-kb-text-muted">
            Calculá cuántos contratos/lotes comprar según cuánto querés arriesgar — antes de entrar, no después.
          </p>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="mb-1 block text-[10px] text-kb-text-secondary">Riesgo ($)</label>
              <input
                type="number"
                step="any"
                value={riesgoDolares}
                onChange={(e) => setRiesgoDolares(e.target.value)}
                placeholder="200"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-kb-text-secondary">Distancia al stop</label>
              <input
                type="number"
                step="any"
                value={distanciaStop}
                onChange={(e) => setDistanciaStop(e.target.value)}
                placeholder="15"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-kb-text-secondary">Valor x punto (1 unidad)</label>
              <input
                type="number"
                step="any"
                value={valorPorPunto}
                onChange={(e) => setValorPorPunto(e.target.value)}
                placeholder="2"
                className={inputClass}
              />
            </div>
          </div>

          {cantidadSugerida !== null && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-kb-gain/30 bg-kb-gain/10 px-3 py-2">
              <p className="text-sm text-kb-text">
                Cantidad sugerida: <span className="font-mono font-bold text-kb-gain">{cantidadSugerida.toFixed(2)}</span>
              </p>
              <button
                type="button"
                onClick={() => {
                  onUsarCantidad(cantidadSugerida.toFixed(2));
                  if (riesgoDolares.trim() !== "") onUsarRiesgo(riesgoDolares);
                }}
                className="rounded-lg bg-kb-gain px-3 py-1.5 text-xs font-semibold text-kb-bg hover:brightness-110 transition"
              >
                Usar esta cantidad
              </button>
            </div>
          )}
          <p className="text-[10px] text-kb-text-muted">
            "Valor x punto" es cuánto vale 1 punto/pip para 1 sola unidad (1 contrato o 1 lote) —
            varía según el instrumento, revisalo en tu bróker si no lo sabés de memoria.
          </p>
        </div>
      )}
    </div>
  );
}

function FormularioTrade({
  accountId,
  tieneCuentas,
  diaParaRegistrar,
  estrategiasDisponibles,
  tradesRecientes,
  onTradeCreado,
}: {
  accountId: string | null;
  tieneCuentas: boolean;
  diaParaRegistrar: string;
  estrategiasDisponibles: Strategy[];
  /** Trades ya cargados de esta cuenta — se usan para "Duplicar último
   * trade", autocompletar símbolos ya usados, y sugerir la sesión y
   * estrategia que más usás, para no arrancar siempre desde cero. */
  tradesRecientes: Trade[];
  onTradeCreado: () => void;
}) {
  // ---- Datos derivados del historial, para hacer la carga más rápida ----
  const ultimoTrade = useMemo(() => {
    if (tradesRecientes.length === 0) return null;
    return [...tradesRecientes].sort(
      (a, b) => new Date(b.entry_time).getTime() - new Date(a.entry_time).getTime()
    )[0];
  }, [tradesRecientes]);

  const sesionSugerida = useMemo(
    () => valorMasFrecuente(tradesRecientes.map((t) => t.session).filter((s): s is TradingSession => s !== null)),
    [tradesRecientes]
  );
  const estrategiaSugerida = useMemo(
    () => valorMasFrecuente(tradesRecientes.map((t) => t.strategy_id).filter((s): s is string => s !== null)),
    [tradesRecientes]
  );
  const simbolosUsados = useMemo(
    () => Array.from(new Set(tradesRecientes.map((t) => t.symbol))).sort(),
    [tradesRecientes]
  );

  const [symbol, setSymbol] = useState("");
  const [instrumentType, setInstrumentType] = useState<InstrumentType>("stock");
  const [side, setSide] = useState<TradeSide>("long");
  const [yaSeCerro, setYaSeCerro] = useState(true);
  // Modo rápido: oculta las secciones opcionales (fechas detalladas,
  // estrategia, psicología, notas) y deja solo lo esencial para cargar
  // en segundos — se puede completar el resto editando el trade después.
  const [modoRapido, setModoRapido] = useState(true);
  const [resultType, setResultType] = useState<ResultType>("tp");
  const [quantity, setQuantity] = useState("");
  const [entryPrice, setEntryPrice] = useState("");
  const [exitPrice, setExitPrice] = useState("");
  const [pips, setPips] = useState("");
  const [fees, setFees] = useState("0");
  const [pnlManual, setPnlManual] = useState("");
  const [riskAmount, setRiskAmount] = useState("");
  // Arrancan con la sesión/estrategia que más usaste últimamente, en vez
  // de "Sin especificar" — la idea es que la mayoría de las veces ni
  // siquiera tengas que tocar estos dos campos.
  const [session, setSession] = useState<TradingSession | "">(sesionSugerida ?? "");
  const [entryTime, setEntryTime] = useState("");
  const [exitTime, setExitTime] = useState("");
  const [tradingviewLinks, setTradingviewLinks] = useState<string[]>([""]);
  const [imagenesEvidencia, setImagenesEvidencia] = useState<File[]>([]);
  const [subiendoImagenes, setSubiendoImagenes] = useState(false);
  const [notes, setNotes] = useState("");
  const [strategyId, setStrategyId] = useState<string>(estrategiaSugerida ?? "");
  const [emotion, setEmotion] = useState<EmotionType | "">("");
  const [mistakes, setMistakes] = useState<MistakeType[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  function alternarError(m: MistakeType) {
    setMistakes((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  }

  // ---- Plantillas rápidas (guardadas en este navegador) ----
  const [plantillas, setPlantillas] = useState<PlantillaTrade[]>(() => cargarPlantillas());
  const [mostrarInputPlantilla, setMostrarInputPlantilla] = useState(false);
  const [nombrePlantillaInput, setNombrePlantillaInput] = useState("");

  function duplicarUltimoTrade() {
    if (!ultimoTrade) return;
    setSymbol(ultimoTrade.symbol);
    setInstrumentType(ultimoTrade.instrument_type);
    setSide(ultimoTrade.side);
    if (ultimoTrade.session) setSession(ultimoTrade.session);
    if (ultimoTrade.strategy_id) setStrategyId(ultimoTrade.strategy_id);
    if (ultimoTrade.risk_amount !== null) setRiskAmount(String(ultimoTrade.risk_amount));
  }

  function aplicarPlantilla(p: PlantillaTrade) {
    setSymbol(p.symbol);
    setInstrumentType(p.instrumentType);
    setSide(p.side);
    setSession(p.session);
    setStrategyId(p.strategyId);
  }

  function guardarComoPlantilla() {
    setNombrePlantillaInput("");
    setMostrarInputPlantilla(true);
  }

  function confirmarGuardarPlantilla() {
    const nombre = nombrePlantillaInput.trim();
    if (!nombre) return;
    const nueva: PlantillaTrade = { nombre, symbol, instrumentType, side, session, strategyId };
    const actualizadas = [...plantillas.filter((p) => p.nombre !== nueva.nombre), nueva];
    setPlantillas(actualizadas);
    guardarPlantillas(actualizadas);
    setMostrarInputPlantilla(false);
    setNombrePlantillaInput("");
  }

  function eliminarPlantilla(nombre: string) {
    const actualizadas = plantillas.filter((p) => p.nombre !== nombre);
    setPlantillas(actualizadas);
    guardarPlantillas(actualizadas);
  }

  // Atajo de teclado: Ctrl+Enter guarda el formulario desde cualquier
  // campo, sin tener que ir hasta el botón con el mouse.
  // Solo dispara si el foco está dentro del formulario para no interferir
  // con otros modales o componentes activos en pantalla.
  useEffect(() => {
    function manejarTecla(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        const form = formRef.current;
        if (!form) return;
        const activo = document.activeElement;
        if (activo && form.contains(activo)) {
          e.preventDefault();
          form.requestSubmit();
        }
      }
    }
    window.addEventListener("keydown", manejarTecla);
    return () => window.removeEventListener("keydown", manejarTecla);
  }, []);


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
        mistake: mistakes.length > 0 ? mistakes[0] : "ninguno",
        mistakes,
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
    setMistakes([]);
    setYaSeCerro(true);
    setExito(true);
    setTimeout(() => setExito(false), 3000);
    onTradeCreado();
  }

  return (
    <section className="rounded-xl border border-kb-border bg-kb-surface p-5">
      {exito && (
        <div className="mb-4 rounded-lg border border-kb-gain/30 bg-kb-gain/10 px-4 py-2.5 text-sm font-medium text-kb-gain">
          ✓ Operación guardada correctamente
        </div>
      )}
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

      {(ultimoTrade || plantillas.length > 0) && (
        <div className="mb-5 rounded-lg border border-kb-border-soft bg-kb-bg p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-kb-text-secondary">
              ⭐ Accesos rápidos
            </p>
            {plantillas.length > 0 && (
              <span className="text-[10px] text-kb-text-muted">(plantillas guardadas en este navegador)</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {ultimoTrade && (
              <button
                type="button"
                onClick={duplicarUltimoTrade}
                className="rounded-full border border-kb-accent/40 bg-kb-accent/10 px-3 py-1.5 text-xs font-medium text-kb-accent hover:bg-kb-accent/20 transition-colors"
              >
                🔁 Duplicar último ({ultimoTrade.symbol})
              </button>
            )}
            {plantillas.map((p) => (
              <span
                key={p.nombre}
                className="group flex items-center gap-1 rounded-full border border-kb-border bg-kb-surface px-3 py-1.5 text-xs font-medium text-kb-text-secondary hover:border-kb-accent hover:text-kb-accent transition-colors"
              >
                <button type="button" onClick={() => aplicarPlantilla(p)}>
                  ⭐ {p.nombre}
                </button>
                <button
                  type="button"
                  onClick={() => eliminarPlantilla(p.nombre)}
                  className="text-kb-text-muted opacity-0 hover:text-kb-loss group-hover:opacity-100 transition-opacity"
                  aria-label={`Eliminar plantilla ${p.nombre}`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mb-5 flex items-center justify-between rounded-lg border border-kb-border-soft bg-kb-bg px-3 py-2.5">
        <div>
          <p className="text-xs font-semibold text-kb-text">
            {modoRapido ? "⚡ Modo rápido" : "📋 Formulario completo"}
          </p>
          <p className="text-[11px] text-kb-text-muted">
            {modoRapido
              ? "Solo lo esencial — completá el resto editando el trade después"
              : "Todos los campos, incluida estrategia, psicología y notas"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModoRapido((v) => !v)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${modoRapido ? "bg-kb-accent" : "bg-kb-border"}`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
              modoRapido ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      <form ref={formRef} onSubmit={handleSubmit} className="space-y-6">
        {/* ---------- Sección 1: qué operaste ---------- */}
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-kb-accent">
            1. ¿Qué operaste?
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo etiqueta="Símbolo" ayuda="El ticker del activo, ej. AAPL, BTC, USDCAD">
              <input
                required
                list="simbolos-usados"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="AAPL"
                className={inputClass}
              />
              <datalist id="simbolos-usados">
                {simbolosUsados.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
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

          <CalculadoraTamañoPosicion
            onUsarCantidad={setQuantity}
            onUsarRiesgo={setRiskAmount}
          />

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

                {!modoRapido && (
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
                )}

                {!modoRapido && (
                  <Campo etiqueta="Comisión" ayuda="Lo que te cobró tu bróker o empresa">
                    <input
                      type="number"
                      step="any"
                      value={fees}
                      onChange={(e) => setFees(e.target.value)}
                      className={inputClass}
                    />
                  </Campo>
                )}

                <Campo
                  etiqueta="P&L (ganancia o pérdida)"
                  ayuda="El resultado bruto en dólares (sin restar la comisión — eso lo hacemos nosotros solos)"
                >
                  <input
                    required
                    type="number"
                    step="any"
                    value={pnlManual}
                    onChange={(e) => {
                      setPnlManual(e.target.value);
                      // En modo rápido no se ve el campo "Resultado" (TP/SL/BE),
                      // así que lo calculamos solos según el signo del P&L —
                      // para que no quede fijo en "Take Profit" por defecto
                      // aunque hayas cargado una operación perdedora.
                      const numero = parseFloat(e.target.value);
                      if (!Number.isNaN(numero)) {
                        setResultType(numero > 0 ? "tp" : numero < 0 ? "sl" : "breakeven");
                      }
                    }}
                    placeholder="200 o -50"
                    className={inputClass}
                  />
                </Campo>
              </>
            )}

            {!modoRapido && (
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
            )}
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
            <Campo
              etiqueta="Sesión (opcional)"
              ayuda={
                modoRapido
                  ? "Al elegirla, completamos sola la hora de entrada con la apertura de esa sesión"
                  : "¿En qué sesión de mercado operaste?"
              }
            >
              <select
                value={session}
                onChange={(e) => {
                  const nuevaSesion = e.target.value as TradingSession | "";
                  setSession(nuevaSesion);
                  if (nuevaSesion !== "") {
                    setEntryTime(horaAperturaSesionLocal(nuevaSesion));
                  }
                }}
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

            {!modoRapido && (
              <>
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
              </>
            )}
          </div>

          {!modoRapido && (
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
          )}

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
        {!modoRapido && (
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
        )}

        {/* ---------- Sección 5: psicología (emoción y error) ---------- */}
        {!modoRapido && (
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

            <Campo etiqueta="¿Cometiste algún error?" ayuda="Tocá los que apliquen — podés marcar varios">
              <div className="flex flex-wrap gap-1.5">
                {(Object.entries(MISTAKE_LABELS) as [MistakeType, string][])
                  .filter(([valor]) => valor !== "ninguno")
                  .map(([valor, etiqueta]) => (
                    <button
                      key={valor}
                      type="button"
                      onClick={() => alternarError(valor)}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                        mistakes.includes(valor)
                          ? "bg-kb-loss/20 text-kb-loss border border-kb-loss/50 shadow-sm"
                          : "border border-kb-border bg-kb-surface text-kb-text-secondary hover:border-kb-loss/40 hover:text-kb-loss"
                      }`}
                    >
                      {mistakes.includes(valor) ? "✕ " : ""}{etiqueta}
                    </button>
                  ))}
              </div>
            </Campo>
          </div>
        </div>
        )}

        {/* ---------- Sección 6: reflexión / journal ---------- */}
        {!modoRapido && (
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
        )}

        {error && (
          <p className="rounded-lg border border-kb-loss/30 bg-kb-loss/10 px-3 py-2 text-xs text-kb-loss">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={enviando}
            className="rounded-lg bg-kb-accent px-5 py-2.5 text-sm font-semibold text-kb-bg hover:brightness-110 transition disabled:opacity-60"
          >
            {enviando ? "Guardando…" : "Guardar operación"}
          </button>
          {mostrarInputPlantilla ? (
            <div className="flex gap-2">
              <input
                type="text"
                autoFocus
                value={nombrePlantillaInput}
                onChange={(e) => setNombrePlantillaInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmarGuardarPlantilla(); } if (e.key === "Escape") setMostrarInputPlantilla(false); }}
                placeholder='Ej: Setup NQ apertura NY'
                className={inputClass + " text-sm"}
              />
              <button
                type="button"
                onClick={confirmarGuardarPlantilla}
                disabled={!nombrePlantillaInput.trim()}
                className="shrink-0 rounded-lg bg-kb-accent px-4 py-2 text-sm font-semibold text-kb-bg hover:brightness-110 disabled:opacity-40 transition"
              >
                Guardar
              </button>
              <button
                type="button"
                onClick={() => setMostrarInputPlantilla(false)}
                className="shrink-0 rounded-lg border border-kb-border px-3 py-2 text-sm text-kb-text-secondary hover:text-kb-text transition-colors"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={guardarComoPlantilla}
              disabled={!symbol.trim()}
              className="rounded-lg border border-kb-border px-4 py-2.5 text-sm font-medium text-kb-text-secondary hover:border-kb-accent hover:text-kb-accent transition-colors disabled:opacity-40"
            >
              ⭐ Guardar como plantilla
            </button>
          )}
          <span className="text-[11px] text-kb-text-muted">
            Tip: <kbd className="rounded border border-kb-border-soft px-1 py-0.5 font-mono">Ctrl</kbd> +{" "}
            <kbd className="rounded border border-kb-border-soft px-1 py-0.5 font-mono">Enter</kbd> guarda rápido
          </span>
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
  variante = "modal",
}: {
  trade: Trade;
  estrategias: Strategy[];
  onClose: () => void;
  onActualizado: () => void;
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
                etiqueta="Errores"
                valor={
                  trade.mistakes && trade.mistakes.length > 0
                    ? trade.mistakes.map((m) => MISTAKE_LABELS[m]).join(", ")
                    : trade.mistake && trade.mistake !== "ninguno"
                    ? MISTAKE_LABELS[trade.mistake]
                    : "Ninguno"
                }
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
  // Hora de cierre: se inicializa al momento actual en formato local para
  // el input datetime-local, pero el usuario puede corregirla si el trade
  // cerró antes y recién ahora lo está registrando.
  const [exitTimeLocal, setExitTimeLocal] = useState(() => {
    const now = new Date();
    const off = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - off).toISOString().slice(0, 16);
  });
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
          // parciales anteriores (si los hubo, ya descontadas sus comisiones
          // por tramo en trade_exits.pnl) más el resultado de este último
          // tramo bruto, y recién ahí se resta la comisión de este tramo.
          // Resultado: realized_pnl es SIEMPRE neto (sin comisiones).
          realized_pnl: Math.round((pnlParcialesPrevios + pnlNumero - comisiones) * 100) / 100,
          result_type: resultType,
          exit_time: new Date(exitTimeLocal).toISOString(),
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
        <div className="col-span-2">
          <Campo etiqueta="Hora de cierre" ayuda="Modificá si el trade cerró antes de ahora">
            <input type="datetime-local" value={exitTimeLocal} onChange={(e) => setExitTimeLocal(e.target.value)} className={inputClass} />
          </Campo>
        </div>
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
  const [fees, setFees] = useState("0");
  const [notas, setNotas] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const cantidadNumero = parseFloat(cantidad);
    const precioSalida = parseFloat(exitPrice);
    const pnlNumero = parseFloat(pnlManual);
    const comisiones = parseFloat(fees || "0");

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
        pnl: Math.round((pnlNumero - comisiones) * 100) / 100,
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
      const { data: todosLosExits, error: exitsError } = await supabase
        .from("trade_exits")
        .select("*")
        .eq("trade_id", trade.id);

      if (exitsError) {
        setEnviando(false);
        setError(`No se pudieron leer los tramos parciales para calcular el P&L final. Detalle: ${exitsError.message}`);
        return;
      }

      const exitsFinal = (todosLosExits as TradeExit[]) ?? [];
      const cantidadTotal = exitsFinal.reduce((acc, ex) => acc + ex.quantity, 0);
      const precioPromedio =
        cantidadTotal > 0
          ? exitsFinal.reduce((acc, ex) => acc + ex.exit_price * ex.quantity, 0) / cantidadTotal
          : precioSalida;
      // pnlTotal ya es neto (cada tramo descontó sus comisiones al guardarse)
      const pnlTotal = exitsFinal.reduce((acc, ex) => acc + ex.pnl, 0);
      // ultimoExitTime: tiempo real del último tramo (no "ahora")
      const ultimoExitTime = exitsFinal.length > 0
        ? exitsFinal.reduce(
            (acc, ex) => (new Date(ex.exit_time).getTime() > new Date(acc).getTime() ? ex.exit_time : acc),
            exitsFinal[0].exit_time
          )
        : ahora;

      const { error: updateError } = await conReintento(() =>
        supabase
          .from("trades")
          .update({
            status: "closed",
            exit_price: Math.round(precioPromedio * 100000) / 100000,
            // pnlTotal ya es neto — NO restar trade.fees de nuevo
            realized_pnl: Math.round(pnlTotal * 100) / 100,
            result_type: "manual",
            exit_time: ultimoExitTime,
          })
          .eq("id", trade.id)
      );

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
        <Campo etiqueta="P&L bruto de este tramo" ayuda="Se resta la comisión al guardar">
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
        <Campo etiqueta="Comisión de este tramo" ayuda="Se descuenta del P&L">
          <input
            type="number"
            step="any"
            value={fees}
            onChange={(e) => setFees(e.target.value)}
            placeholder="0"
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
    // realized_pnl se guarda neto; al editar mostramos el bruto (neto + fees)
    // Redondeamos a 2 decimales para evitar errores de punto flotante (ej. 0.1+0.2=0.300...04)
    trade.realized_pnl !== null
      ? String(Math.round((trade.realized_pnl + (trade.fees ?? 0)) * 100) / 100)
      : ""
  );
  const [riskAmount, setRiskAmount] = useState(trade.risk_amount !== null ? String(trade.risk_amount) : "");
  const [resultType, setResultType] = useState<ResultType>(trade.result_type ?? "manual");
  const [session, setSession] = useState<TradingSession | "">(trade.session ?? "");
  const [strategyId, setStrategyId] = useState(trade.strategy_id ?? "");
  const [emotion, setEmotion] = useState<EmotionType | "">(trade.emotion ?? "");
  const [mistakes, setMistakes] = useState<MistakeType[]>(
    trade.mistakes && trade.mistakes.length > 0
      ? trade.mistakes
      : trade.mistake && trade.mistake !== "ninguno"
      ? [trade.mistake]
      : []
  );

  function alternarError(m: MistakeType) {
    setMistakes((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  }
  const [tradingviewLinks, setTradingviewLinks] = useState<string[]>(
    trade.tradingview_links && trade.tradingview_links.length > 0 ? trade.tradingview_links : [""]
  );
  const [imagenesExistentes, setImagenesExistentes] = useState<string[]>(trade.evidence_images ?? []);
  const [imagenesNuevas, setImagenesNuevas] = useState<File[]>([]);
  const [subiendoImagenes, setSubiendoImagenes] = useState(false);
  const [notes, setNotes] = useState(trade.notes ?? "");
  // Fechas de entrada/salida editables (datetime-local usa hora LOCAL del
  // navegador; al guardar las convertimos de vuelta a ISO UTC).
  const [entryTimeLocal, setEntryTimeLocal] = useState(() => {
    const d = new Date(trade.entry_time);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [exitTimeLocal, setExitTimeLocal] = useState(() => {
    if (!trade.exit_time) return "";
    const d = new Date(trade.exit_time);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
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

    const esAbierta = trade.status === "open";

    if (Number.isNaN(cantidad) || Number.isNaN(precioEntrada)) {
      setError("Cantidad y precio de entrada son obligatorios.");
      return;
    }
    if (!esAbierta && (Number.isNaN(precioSalida) || Number.isNaN(pnlNumero))) {
      setError("Para trades cerrados, el precio de salida y P&L son obligatorios.");
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
            // Reintento manual para uploads: usamos la misma ruta para no
            // generar archivos huérfanos en el bucket entre intentos.
            let uploadError = (await supabase.storage.from("trade-evidence").upload(ruta, archivo)).error;
            if (uploadError) {
              uploadError = (await supabase.storage.from("trade-evidence").upload(ruta, archivo, { upsert: true })).error;
            }
            return uploadError ? null : ruta;
          })
        );
        rutasNuevas = subidas.filter((r): r is string => r !== null);
        setSubiendoImagenes(false);
        if (rutasNuevas.length < imagenesNuevas.length) {
          setError(`${imagenesNuevas.length - rutasNuevas.length} imagen(es) no se pudieron subir. El trade se guardó sin ellas.`);
        }
      }
    }

    const { error: updateError } = await conReintento(() =>
      supabase
        .from("trades")
        .update({
          symbol: symbol.trim().toUpperCase(),
          instrument_type: instrumentType,
          side,
          quantity: cantidad,
          entry_price: precioEntrada,
          exit_price: esAbierta ? null : precioSalida,
          entry_time: new Date(entryTimeLocal).toISOString(),
          exit_time: exitTimeLocal.trim() !== "" ? new Date(exitTimeLocal).toISOString() : null,
          pips: pips.trim() === "" ? null : parseFloat(pips),
          fees: comisiones,
          realized_pnl: esAbierta ? null : Math.round((pnlNumero - comisiones) * 100) / 100,
          risk_amount: riskAmount.trim() === "" ? null : parseFloat(riskAmount),
          result_type: resultType,
          session: session === "" ? null : session,
          strategy_id: strategyId === "" ? null : strategyId,
          emotion: emotion === "" ? null : emotion,
          mistake: mistakes.length > 0 ? mistakes[0] : "ninguno",
          mistakes,
          tradingview_links: tradingviewLinks.map((l) => l.trim()).filter((l) => l !== ""),
          evidence_images: [...imagenesExistentes, ...rutasNuevas],
          notes: notes.trim() === "" ? null : notes.trim(),
        })
        .eq("id", trade.id)
    );
    setEnviando(false);

    if (updateError) {
      setError("No se pudo guardar los cambios (lo intentamos dos veces). Revisa tu conexión e intenta de nuevo.");
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
        <Campo etiqueta="Salida" ayuda={trade.status === "open" ? "Opcional para trades abiertos" : undefined}>
          <input type="number" step="any" value={exitPrice} onChange={(e) => setExitPrice(e.target.value)} className={inputClass} placeholder={trade.status === "open" ? "— trade abierto —" : ""} />
        </Campo>
        <Campo etiqueta="Pips">
          <input type="number" step="any" value={pips} onChange={(e) => setPips(e.target.value)} className={inputClass} />
        </Campo>
        <Campo etiqueta="Comisión">
          <input type="number" step="any" value={fees} onChange={(e) => setFees(e.target.value)} className={inputClass} />
        </Campo>
        <Campo etiqueta="Fecha/hora de entrada" ayuda="Hora local del dispositivo">
          <input
            type="datetime-local"
            value={entryTimeLocal}
            onChange={(e) => setEntryTimeLocal(e.target.value)}
            className={inputClass}
          />
        </Campo>
        <Campo etiqueta="Fecha/hora de salida" ayuda={trade.status === "open" ? "Opcional para trades abiertos" : "Hora local del dispositivo"}>
          <input
            type="datetime-local"
            value={exitTimeLocal}
            onChange={(e) => setExitTimeLocal(e.target.value)}
            className={inputClass}
            placeholder={trade.status === "open" ? "— trade abierto —" : ""}
          />
        </Campo>
        <Campo etiqueta="P&L (bruto)" ayuda={trade.status === "open" ? "Opcional para trades abiertos" : "Se resta la comisión automáticamente al guardar"}>
          <input type="number" step="any" value={pnlManual} onChange={(e) => setPnlManual(e.target.value)} className={inputClass} placeholder={trade.status === "open" ? "— trade abierto —" : ""} />
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
        <Campo etiqueta="Errores" ayuda="Tocá los que apliquen — podés marcar varios">
          <div className="flex flex-wrap gap-1.5">
            {(Object.entries(MISTAKE_LABELS) as [MistakeType, string][])
              .filter(([valor]) => valor !== "ninguno")
              .map(([valor, etiqueta]) => (
                <button
                  key={valor}
                  type="button"
                  onClick={() => alternarError(valor)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                    mistakes.includes(valor)
                      ? "bg-kb-loss/20 text-kb-loss border border-kb-loss/50 shadow-sm"
                      : "border border-kb-border bg-kb-surface text-kb-text-secondary hover:border-kb-loss/40 hover:text-kb-loss"
                  }`}
                >
                  {mistakes.includes(valor) ? "✕ " : ""}{etiqueta}
                </button>
              ))}
          </div>
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
                  {t.mistakes && t.mistakes.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {t.mistakes.map((m) => (
                        <span key={m} className="rounded-full bg-kb-accent/10 px-2 py-0.5 text-xs font-medium text-kb-accent">
                          {MISTAKE_LABELS[m]}
                        </span>
                      ))}
                    </div>
                  ) : t.mistake && t.mistake !== "ninguno" ? (
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
                  <div className="flex flex-col gap-0.5">
                    {t.tradingview_links && t.tradingview_links.length > 0 ? (
                      <a
                        href={t.tradingview_links[0]}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-kb-accent hover:underline"
                      >
                        📈 Gráfico{t.tradingview_links.length > 1 ? ` (+${t.tradingview_links.length - 1})` : ""}
                      </a>
                    ) : null}
                    {t.evidence_images && t.evidence_images.length > 0 ? (
                      <span className="text-xs text-kb-text-secondary">
                        🖼 {t.evidence_images.length} imagen{t.evidence_images.length > 1 ? "es" : ""}
                      </span>
                    ) : null}
                    {(!t.tradingview_links || t.tradingview_links.length === 0) &&
                      (!t.evidence_images || t.evidence_images.length === 0) && (
                      <span className="text-xs text-kb-text-muted">—</span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}