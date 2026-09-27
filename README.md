# before-you-dispatch-api

Backend for **Before You Dispatch**: orders, statuses, link generation, and messaging integration. See [CLAUDE.md](CLAUDE.md) for full product context and scope.

Stack: Node.js, Express, TypeScript, Prisma 7, PostgreSQL (hosted on Supabase).

API endpoints and request/response shapes are documented in [API.md](API.md).

## Requirements

- Node.js 20 or newer
- Yarn 1.x (`npm install -g yarn`)
- A PostgreSQL database (Supabase works; use its **Session pooler** connection string)

## Setup

```bash
git clone <repo-url> before-you-dispatch-api
cd before-you-dispatch-api
yarn install              # also generates the Prisma client
cp .env.example .env      # then fill in DATABASE_URL and the rest
yarn db:deploy            # apply database migrations
yarn db:seed              # add a sample rider (id: seed-rider-1)
yarn dev
```

The API starts on `http://localhost:4000` (or whatever `PORT` is set to).

Check it's up:

```bash
curl http://localhost:4000/health
# {"status":"ok"}
```

## Scripts

| Script            | What it does                                              |
| ----------------- | --------------------------------------------------------- |
| `yarn dev`        | Runs `src/index.ts` with nodemon, reloads on save         |
| `yarn build`      | Generates the Prisma client and compiles to `dist/`       |
| `yarn start`      | Runs the compiled build from `dist/`                      |
| `yarn db:migrate` | Creates a new migration after a schema change (local dev) |
| `yarn db:deploy`  | Applies pending migrations (use this on deploy)           |
| `yarn db:seed`    | Seeds a sample rider                                      |

## Environment variables

| Variable         | Purpose                                                |
| ---------------- | ------------------------------------------------------ |
| `PORT`           | Port the API listens on (default `4000`)               |
| `CORS_ORIGIN`    | Frontend origin(s) allowed by CORS, comma-separated    |
| `DATABASE_URL`   | PostgreSQL connection string                           |
| `TERMII_API_KEY` | Termii SMS gateway API key, for sending delivery links |

## Project structure

```
prisma/
├── schema.prisma  — database models (Order, Rider)
├── migrations/    — SQL migrations, committed to git
└── seed.ts        — sample rider for local dev
src/
├── index.ts       — starts the server
├── app.ts         — Express app setup (CORS, JSON, routes, error handling)
├── config/        — environment/config loading
├── lib/prisma.ts  — shared Prisma client
├── routes/        — route handlers
├── models/        — reserved; data models live in prisma/schema.prisma
└── generated/     — Prisma client output (gitignored, rebuilt on install)
```
