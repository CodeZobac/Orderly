Run app commands from source/:
- npm ci; configure ignored .env.local from .env.example; deploy source/supabase/migrations via GitHub integration; npm run db:check; npm run dev.
- npm run lint; npm run typecheck; npm test; npm run build; npm run test:browser. Browser fixture uses app3200/RPC3001, isolated embedded Postgres, no live Supabase. Restricted IPC/browser environments need execution permissions.
- npm run db:import -- /absolute/path/orderly.sqlite explicitly imports read-only legacy file into empty Supabase target; stop old app/back up first. CLI scripts load .env.local. npm run db:check verifies RPC, does not deploy.
- npx supabase migration new descriptive_name creates versioned schema change; GitHub deploy source working directory/main production. No direct production mutation unless explicitly requested.
- npm start after build; npm run smoke:production against isolated configured origin (ORDERLY_SMOKE_ORIGIN default localhost3100), creates test account/client; production cookies require HTTPS.
- npm run format; npm audit --omit=dev. Root serena memories check when available. Current setup handoff docs/implementation/handoffs/supabase-foundation.md.