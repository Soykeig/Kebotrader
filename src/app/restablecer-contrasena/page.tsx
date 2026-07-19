"use client";

import { useEffect, useState, FormEvent } from "react";
import { supabase } from "@/lib/supabase";

// =====================================================================
// Página de restablecer contraseña.
//
// Cuando el usuario pide "¿Olvidaste tu contraseña?" en el login, Supabase
// le manda un correo con un link que apunta acá. Como el cliente de
// Supabase está configurado con detectSessionInUrl: true (ver
// src/lib/supabase.ts), automáticamente detecta el token de recuperación
// que viene en la URL y arma una sesión temporal válida solo para poder
// cambiar la contraseña — no hace falta que el usuario esté "logueado"
// de la forma normal.
// =====================================================================

export default function RestablecerContrasenaPage() {
  const [listo, setListo] = useState(false);
  const [tieneSesionValida, setTieneSesionValida] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmarPassword, setConfirmarPassword] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);

  useEffect(() => {
    // Al cargar la página, Supabase ya debería haber leído el token de
    // la URL y creado la sesión temporal. Confirmamos que exista antes
    // de mostrar el formulario — si alguien entra a esta página sin
    // venir de un link válido, no tiene sentido dejarlo cambiar nada.
    supabase.auth.getSession().then(({ data }) => {
      setTieneSesionValida(!!data.session);
      setListo(true);
    });
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (password !== confirmarPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setEnviando(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setEnviando(false);

    if (updateError) {
      setError("No se pudo actualizar la contraseña. El link puede haber expirado — pedí uno nuevo desde el login.");
      return;
    }
    setExito(true);
  }

  if (!listo) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-kb-bg">
        <p className="text-sm text-kb-text-secondary">Cargando…</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-kb-bg px-4">
      <div className="w-full max-w-sm rounded-2xl border border-kb-border bg-kb-surface p-7 shadow-2xl">
        <h1 className="font-display text-xl font-bold text-kb-text">Restablecer contraseña</h1>

        {!tieneSesionValida ? (
          <>
            <p className="mt-3 text-sm text-kb-text-secondary">
              Este link no es válido o ya expiró. Volvé a la app e intentá de nuevo desde
              &quot;¿Olvidaste tu contraseña?&quot; en el login.
            </p>
            <a
              href="/"
              className="mt-5 block w-full rounded-lg bg-kb-accent py-2.5 text-center text-sm font-semibold text-kb-bg hover:brightness-110 transition"
            >
              Volver al inicio
            </a>
          </>
        ) : exito ? (
          <>
            <p className="mt-3 text-sm text-kb-gain">
              ✅ Tu contraseña se actualizó correctamente. Ya podés iniciar sesión con la nueva.
            </p>
            <a
              href="/"
              className="mt-5 block w-full rounded-lg bg-kb-accent py-2.5 text-center text-sm font-semibold text-kb-bg hover:brightness-110 transition"
            >
              Ir a iniciar sesión
            </a>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-kb-text-secondary">
                Nueva contraseña
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
            <div>
              <label className="mb-1 block text-xs font-medium text-kb-text-secondary">
                Confirmar nueva contraseña
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={confirmarPassword}
                onChange={(e) => setConfirmarPassword(e.target.value)}
                className="w-full rounded-lg border border-kb-border bg-kb-bg px-3 py-2 text-sm text-kb-text outline-none focus:border-kb-accent"
              />
            </div>

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
              {enviando ? "Guardando…" : "Actualizar contraseña"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}