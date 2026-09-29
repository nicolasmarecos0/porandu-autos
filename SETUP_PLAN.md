# Porandú Autos — Setup Plan (commits 1–5 de B1)

Este plan cubre la estructura inicial del repositorio y los comandos exactos para crearlo. No incluye componentes ni lógica de producto.

---

## 1. Estructura final inicial

Estado del repo al cerrar el commit 5. Las carpetas vacías llevan `.gitkeep`.

```text
porandu-autos/
├── .github/workflows/ci.yml        # commit 3
├── .env.example                    # commit 4
├── .gitignore                      # create-next-app (+ .env*.local)
├── .nvmrc                          # 24
├── .prettierrc.json / .prettierignore
├── CLAUDE.md
├── README.md
├── drizzle.config.ts               # commit 5
├── eslint.config.mjs               # create-next-app (+ prettier)
├── next.config.ts
├── package.json / pnpm-lock.yaml
├── postcss.config.mjs
├── tsconfig.json                   # strict + noUncheckedIndexedAccess
├── vitest.config.mts               # commit 3
├── app/
│   ├── layout.tsx / globals.css / page.tsx   # scaffold, sin producto
├── components/ui/                  # .gitkeep
├── domains/                        # .gitkeep
├── db/
│   ├── schema/                     # commit 5
│   └── migrations/                 # commit 5
├── mocks/                          # .gitkeep
├── lib/env.ts                      # commit 4
├── supabase/config.toml            # commit 5 (supabase init)
├── tests/
│   ├── unit/  tenant/  e2e/        # .gitkeep
├── public/
└── docs/
    ├── 00_MASTER_CONTEXT.md
    ├── 01_TECHNICAL_BLUEPRINT_v1.1.md
    ├── 02_VISUAL_PRODUCT_BLUEPRINT_v0.1.md
    ├── 03_BUILD_BASELINE_B1.md
    └── 05_DECISIONS_LOG.md         # 04_FUTURE_BACKLOG.md queda reservado
```

La carpeta `app/(auth)` y `app/(app)` con sus rutas se crean en los commits 8 y 10, no en el setup.

---

## 2. Comandos

### 0 · Prerrequisitos
```bash
node -v                          # debe ser v24.x
corepack enable
corepack prepare pnpm@latest --activate
pnpm -v
docker info                      # Supabase local requiere Docker corriendo
gh auth status                   # GitHub CLI autenticado
```

### Commit 1 · repo + docs
El scaffold se genera **sin git** para que la documentación sea el primer commit.

```bash
pnpm create next-app@latest porandu-autos \
  --ts --tailwind --eslint --app --no-src-dir \
  --import-alias "@/*" --use-pnpm --disable-git --yes
cd porandu-autos

# Reemplazar el README generado y agregar CLAUDE.md y docs/ (archivos preparados)
cp <ruta-preparada>/README.md ./README.md
cp <ruta-preparada>/CLAUDE.md ./CLAUDE.md
cp -r <ruta-preparada>/docs ./docs

git init -b main
git add README.md CLAUDE.md docs/
git commit -m "chore: init repo, README, docs/ (baselines, B1, decisions log)"
```

### Commit 2 · scaffold + convenciones
```bash
echo "24" > .nvmrc
pnpm pkg set packageManager="pnpm@$(pnpm -v)"
pnpm pkg set engines.node=">=24 <25"

pnpm add -D prettier prettier-plugin-tailwindcss eslint-config-prettier
echo '{ "plugins": ["prettier-plugin-tailwindcss"] }' > .prettierrc.json
printf "pnpm-lock.yaml\n.next\ndb/migrations\n" > .prettierignore
# eslint.config.mjs: agregar eslint-config-prettier al final del array

# tsconfig.json: confirmar "strict": true y agregar "noUncheckedIndexedAccess": true

pnpm pkg set scripts.typecheck="tsc --noEmit"
pnpm pkg set scripts.format="prettier --write ."
pnpm pkg set scripts.format:check="prettier --check ."
mkdir -p components/ui domains db/schema db/migrations mocks lib tests/unit tests/tenant tests/e2e
touch components/ui/.gitkeep domains/.gitkeep mocks/.gitkeep tests/{unit,tenant,e2e}/.gitkeep

pnpm format && pnpm typecheck && pnpm lint && pnpm build
git add -A
git commit -m "chore: scaffold Next.js + TS strict, pnpm, ESLint, Prettier"

gh repo create porandu-autos --private --source=. --remote=origin --push
```

### Commit 3 · CI
```bash
pnpm add -D vitest vite-tsconfig-paths @vitejs/plugin-react
pnpm pkg set scripts.test="vitest run --passWithNoTests"
mkdir -p .github/workflows
# crear vitest.config.mts y .github/workflows/ci.yml (contenido abajo)
git add -A && git commit -m "ci: typecheck, lint, test, build"
git push
```

Contenido de `.github/workflows/ci.yml`:
```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm format:check
      - run: pnpm test
      - run: pnpm build
```

Playwright se instala en el commit 17, junto con el primer test E2E, para no descargar browsers en CI antes de tiempo. En el commit 7 se agrega un job de CI con `supabase/setup-cli` para los tests de tenant contra Postgres real.

### Commit 4 · env
```bash
# crear lib/env.ts (validación pura), lib/env.public.ts y lib/env.server.ts (server-only)
# crear .env.example (solo placeholders); verificar que .gitignore cubre .env*
git add -A && git commit -m "chore(env): env validation + .env.example"
```

Sin dependencias nuevas: la validación es TypeScript plano y Next resuelve `server-only` internamente. El contrato vigente está en `.env.example` y en el README: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `RUNTIME_DATABASE_URL` (rol `app_runtime`) y `MIGRATION_DATABASE_URL` (rol `postgres`, solo `drizzle-kit`). No hay `DATABASE_URL` genérico ni `SUPABASE_SECRET_KEY` (ADR-001).

La validación no corre en build: los módulos de env se invocan cuando se usan, así que CI no necesita valores dummy mientras nada los consuma.

### Commit 5 · Supabase + Drizzle + schema base
```bash
pnpm add @supabase/supabase-js @supabase/ssr drizzle-orm postgres
pnpm add -D supabase drizzle-kit
pnpm approve-builds              # pnpm 10 bloquea postinstall: aprobar "supabase"

pnpm pkg set scripts.sb:start="supabase start"
pnpm pkg set scripts.sb:stop="supabase stop"
pnpm pkg set scripts.sb:status="supabase status"
pnpm pkg set scripts.db:generate="drizzle-kit generate"
pnpm pkg set scripts.db:migrate="drizzle-kit migrate"
pnpm pkg set scripts.db:studio="drizzle-kit studio"

pnpm supabase init
pnpm sb:start
pnpm sb:status                   # copiar URL y keys a .env.local

# crear drizzle.config.ts y db/schema: organizations, profiles, memberships
pnpm db:generate
pnpm db:migrate
git add -A && git commit -m "feat(db): Supabase local + Drizzle + organizations/profiles/memberships"
```

A partir del commit 6 empieza el **spike de ADR-001**, que es un gate: no se avanza hasta registrar su resultado.

### Commit 18 · staging (referencia)
```bash
pnpm dlx vercel@latest link
pnpm dlx vercel@latest env add   # variables de staging; RUNTIME_DATABASE_URL solo server (Vercel no recibe MIGRATION_DATABASE_URL)
MIGRATION_DATABASE_URL=<staging> pnpm db:migrate
pnpm dlx vercel@latest deploy
```
