"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase, type Profile, type Trade, type Account } from "@/lib/supabase";

// =====================================================================
// Página pública de solo lectura de un usuario de KeboTrader.
//
// A propósito NO comparte diseño con el resto de la app (no tiene
// sidebar, no tiene menú, no depende de estar logueado) — es una
// página independiente, pensada para compartir por link. Nadie que
// entre acá puede editar nada; solo se muestran datos agregados de
// las cuentas del usuario que activó esta opción desde su Perfil.
// =====================================================================

function formatCurrency(value: number): string {
  return value.toLocaleString("es-ES", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function PaginaPublicaPerfil() {
  const params = useParams();
  const token = params?.token as string;

  const [cargando, setCargando] = useState(true);
  const [perfil, setPerfil] = useState<Profile | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [cuentas, setCuentas] = useState<Account[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function cargar() {
      if (!token) {
        setError(true);
        setCargando(false);
        return;
      }

      // Este SELECT solo devuelve resultado si el dueño del perfil tiene
      // public_enabled = true — la política de seguridad de la base de
      // datos (RLS) es la que realmente protege esto, no el código de acá.
      const { data: perfilData } = await supabase
        .from("profiles")
        .select("*")
        .eq("public_token", token)
        .eq("public_enabled", true)
        .maybeSingle();

      if (!perfilData) {
        setError(true);
        setCargando(false);
        return;
      }

      const p = perfilData as Profile;
      setPerfil(p);

      const [tradesRes, cuentasRes] = await Promise.all([
        supabase.from("trades").select("*").eq("user_id", p.id).eq("status", "closed"),
        supabase.from("accounts").select("*").eq("user_id", p.id).eq("is_archived", false),
      ]);

      setTrades((tradesRes.data as Trade[]) ?? []);
      setCuentas((cuentasRes.data as Account[]) ?? []);
      setCargando(false);
    }
    cargar();
  }, [token]);

  const stats = useMemo(() => {
    const cerrados = trades
      .filter((t) => t.realized_pnl !== null)
      .sort((a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime());

    const totalPnl = cerrados.reduce((acc, t) => acc + (t.realized_pnl ?? 0), 0);
    const ganadores = cerrados.filter((t) => (t.realized_pnl ?? 0) > 0);
    const winRate = cerrados.length > 0 ? (ganadores.length / cerrados.length) * 100 : 0;

    let acumulado = 0;
    const curva = cerrados.map((t) => {
      acumulado += t.realized_pnl ?? 0;
      return acumulado;
    });

    return {
      totalPnl,
      winRate,
      totalTrades: cerrados.length,
      curva,
      cuentasActivas: cuentas.length,
    };
  }, [trades, cuentas]);

  if (cargando) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0a0e14]">
        <p className="text-sm text-white/50">Cargando…</p>
      </main>
    );
  }

  if (error || !perfil) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0a0e14] px-4">
        <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#12161f] p-7 text-center">
          <p className="text-2xl">🔒</p>
          <h1 className="mt-3 text-lg font-bold text-white">Esta página no está disponible</h1>
          <p className="mt-2 text-sm text-white/50">
            El link puede haber cambiado, o el usuario desactivó su página pública.
          </p>
        </div>
      </main>
    );
  }

  const nombre = perfil.display_name || "Trader de KeboTrader";
  const inicial = nombre.slice(0, 1).toUpperCase();
  const maxCurva = Math.max(...stats.curva, 0);
  const minCurva = Math.min(...stats.curva, 0);
  const rangoCurva = maxCurva - minCurva || 1;

  return (
    <main className="min-h-screen bg-[#0a0e14] px-4 py-10 text-white">
      <div className="mx-auto max-w-xl">
        {/* ---------- Encabezado del perfil ---------- */}
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#12161f]">
          <div className="h-20 bg-gradient-to-r from-emerald-500/20 via-[#12161f] to-emerald-500/10" />
          <div className="px-6 pb-6">
            <div className="-mt-10 flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border-4 border-[#12161f] bg-emerald-500/15 text-2xl font-bold text-emerald-400">
              {inicial}
            </div>
            <h1 className="mt-3 text-xl font-bold">{nombre}</h1>
            {perfil.bio && <p className="mt-1 text-sm text-white/60">{perfil.bio}</p>}
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/50">
              {perfil.trading_style && (
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                  📈 {perfil.trading_style}
                </span>
              )}
              {perfil.started_year && (
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                  🗓️ Trading desde {perfil.started_year}
                </span>
              )}
              {perfil.location && (
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                  📍 {perfil.location}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ---------- Estadísticas clave ---------- */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-white/10 bg-[#12161f] p-4 text-center">
            <p className="text-[10px] uppercase tracking-wide text-white/40">P&amp;L total</p>
            <p className={`mt-1 font-mono text-lg font-bold ${stats.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {formatCurrency(stats.totalPnl)}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#12161f] p-4 text-center">
            <p className="text-[10px] uppercase tracking-wide text-white/40">Win rate</p>
            <p className="mt-1 font-mono text-lg font-bold text-white">{stats.winRate.toFixed(1)}%</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#12161f] p-4 text-center">
            <p className="text-[10px] uppercase tracking-wide text-white/40">Operaciones</p>
            <p className="mt-1 font-mono text-lg font-bold text-white">{stats.totalTrades}</p>
          </div>
        </div>

        {/* ---------- Curva de equity ---------- */}
        {stats.curva.length > 1 && (
          <div className="mt-4 rounded-xl border border-white/10 bg-[#12161f] p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/40">Curva de equity</p>
            <svg viewBox="0 0 800 180" className="h-36 w-full" preserveAspectRatio="none">
              <defs>
                <linearGradient id="curvaPublica" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stats.totalPnl >= 0 ? "#34d399" : "#f87171"} stopOpacity="0.3" />
                  <stop offset="100%" stopColor={stats.totalPnl >= 0 ? "#34d399" : "#f87171"} stopOpacity="0" />
                </linearGradient>
              </defs>
              {(() => {
                const coordX = (i: number) => (i / Math.max(stats.curva.length - 1, 1)) * 800;
                const coordY = (v: number) => 180 - ((v - minCurva) / rangoCurva) * 180;
                const path = stats.curva.map((v, i) => `${i === 0 ? "M" : "L"} ${coordX(i)} ${coordY(v)}`).join(" ");
                const area = `${path} L ${coordX(stats.curva.length - 1)} ${coordY(minCurva)} L ${coordX(0)} ${coordY(minCurva)} Z`;
                return (
                  <>
                    <path d={area} fill="url(#curvaPublica)" />
                    <path
                      d={path}
                      fill="none"
                      stroke={stats.totalPnl >= 0 ? "#34d399" : "#f87171"}
                      strokeWidth="2"
                    />
                  </>
                );
              })()}
            </svg>
          </div>
        )}

        {stats.totalTrades === 0 && (
          <p className="mt-6 text-center text-sm text-white/40">
            Todavía no hay operaciones cerradas para mostrar.
          </p>
        )}

        {/* ---------- Footer ---------- */}
        <p className="mt-8 text-center text-xs text-white/30">
          Generado con{" "}
          <a href="/" className="text-emerald-400 hover:underline">
            KeboTrader
          </a>{" "}
          — solo lectura, sin datos editables.
        </p>
      </div>
    </main>
  );
}