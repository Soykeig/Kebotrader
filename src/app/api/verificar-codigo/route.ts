import { NextRequest, NextResponse } from "next/server";

/**
 * Verifica el código de acceso para poder registrarse. El registro
 * está cerrado por ahora — solo entra quien tenga el código que vos
 * compartís a mano con esa persona.
 *
 * El código correcto vive en la variable de entorno CODIGO_REGISTRO
 * (SIN el prefijo NEXT_PUBLIC_, para que nunca quede visible en el
 * código fuente que le llega al navegador). Para cambiarlo, editá esa
 * variable en tu .env.local (y en Vercel, para producción) — no hace
 * falta tocar código.
 */
export async function POST(request: NextRequest) {
  try {
    const { codigo } = await request.json();
    const codigoCorrecto = process.env.CODIGO_REGISTRO;

    if (!codigoCorrecto) {
      // Si no configuraste ningún código, por seguridad el registro
      // queda cerrado para todos (mejor eso que dejarlo abierto sin querer).
      return NextResponse.json({ valido: false });
    }

    const valido = typeof codigo === "string" && codigo.trim() === codigoCorrecto;
    return NextResponse.json({ valido });
  } catch {
    return NextResponse.json({ valido: false }, { status: 400 });
  }
}