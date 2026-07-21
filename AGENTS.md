# AGENTS.md

## Cursor Cloud specific instructions

This is a frontend-only Vite + React 19 + TypeScript SPA (a Persian/RTL daily market dashboard). There is no backend, database, or container to run — the only service is the Vite dev server.

- Package manager is npm (`package-lock.json`). Dependencies are installed automatically by the startup update script.
- Standard commands live in `package.json`: `npm run dev` (Vite dev server on port 5173, host exposed), `npm run build` (`tsc -b && vite build`), `npm run lint` (oxlint), `npm run preview`.
- The dashboard live-refreshes commodities from the public TGJU API (`api.tgju.org`) client-side. If outbound network to TGJU is blocked, the app degrades gracefully to bundled seed data (`src/data/seed.ts`) and marks the source status as errored — the UI still fully renders and is testable offline. Treat TGJU as optional.
