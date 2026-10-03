@echo off
cd /d "C:\Users\kelvi\OneDrive\Documentos\Kebotrader"
echo Committing and pushing...
git add src/app/page.tsx
git commit -m "fix: Tradeify icon domain + auto-apply cascada sin DLL

- Corrige dominio tradeify.io -> tradeify.com (icono roto)
- elegirMonto() auto-aplica cuando no hay seleccion de DLL
- elegirGrupo() auto-aplica cuando el grupo no tiene toggle DLL
- LucidFlex ahora no muestra paso DLL (correcto, no tiene DLL)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WudPzCbFrUDfGeb4BD468S"
git push
echo.
echo ✅ Deployed! Check Vercel for the build.
pause
