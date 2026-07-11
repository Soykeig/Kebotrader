// src/app/layout.tsx
import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Display: para titulares — carácter editorial, condensada, con personalidad.
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700", "800"],
});

// Cuerpo: legible, neutra, para texto y UI.
const body = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
});

// Mono: para precios, cifras y tickers — los traders leen números en mono.
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "KTrader — Tu diario de trading",
  description:
    "Registra, analiza y mejora cada una de tus operaciones en un solo lugar. KeboTrader es tu diario de trading privado y oscuro.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="dark">
      <body
        className={`${display.variable} ${body.variable} ${mono.variable} antialiased`}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}