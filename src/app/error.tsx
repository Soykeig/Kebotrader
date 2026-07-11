// src/app/error.tsx
"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Queda registrado en la consola del navegador para poder debuguear
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-kb-bg px-6 text-center">
      <p className="font-mono text-sm text-kb-loss">Algo salió mal</p>
      <h1 className="mt-2 font-display text-3xl font-bold text-kb-text">
        Ups, hubo un error
      </h1>
      <p className="mt-2 max-w-sm text-sm text-kb-text-secondary">
        No se pudo cargar esta parte de la app. Tus datos están a salvo — probá recargar la
        página o volver al Dashboard.
      </p>
      <div className="mt-6 flex gap-3">
        <button
          onClick={() => reset()}
          className="rounded-lg bg-kb-accent px-5 py-2.5 text-sm font-semibold text-kb-bg hover:brightness-110 transition"
        >
          Intentar de nuevo
        </button>
        <a
          href="/"
          className="rounded-lg border border-kb-border px-5 py-2.5 text-sm font-medium text-kb-text hover:border-kb-accent hover:text-kb-accent transition-colors"
        >
          Volver al inicio
        </a>
      </div>
    </main>
  );
}
