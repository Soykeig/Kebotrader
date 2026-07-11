// src/app/not-found.tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-kb-bg px-6 text-center">
      <p className="font-mono text-sm text-kb-accent">Error 404</p>
      <h1 className="mt-2 font-display text-3xl font-bold text-kb-text">
        Esta página no existe
      </h1>
      <p className="mt-2 max-w-sm text-sm text-kb-text-secondary">
        Puede que el link esté roto, o que la página se haya movido. Volvé al Dashboard para
        seguir con tu diario de trading.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-lg bg-kb-accent px-5 py-2.5 text-sm font-semibold text-kb-bg hover:brightness-110 transition"
      >
        Volver al inicio
      </Link>
    </main>
  );
}
