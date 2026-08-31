# fleet-live 🚚

A full-stack fleet management application built with **TypeScript, Node.js, Express, React and SQLite**.

> **Status: Work in progress.** Phases 1–4 are in place (vehicles, UI, live map, login and company isolation). The app is a personal engineering project, not a finished product.

This is closer to a real fleet system than a tutorial: server-driven lists, SSE with per-connection focus, trips as encoded polylines, and tenant isolation by company. GPS is simulated. Alerts exist only as a count on the vehicle.

---

## Overview

`fleet-live` monitors vehicles, last positions, live movement and trip paths for **one company per logged-in user**.

The React UI talks to the Express API over HTTP and SSE (`/api`). Unauthenticated vehicle, stream and sim requests are `401`. Other companies’ vehicles are `404`, not listed.

**Next product step:** alerts REST API and UI. Table, seed rows and `active_alerts` already exist.

---

## Current Status

### Implemented

* TypeScript monorepo: `apps/api`, `apps/web`, `packages/shared`
* Express 5 API, SQLite (WAL, statement cache, lightweight migrations)
* Vehicle CRUD; server-driven list (search, filter, sort, pagination, facet counts)
* Shared Zod contract (`@fleet-live/shared`); field-level German `error`/`fields`; English `code`
* Telemetry hot buffer (rolling window) and trip paths as encoded polylines
* SSE with per-connection focus; telemetry patches and `vehicles-changed` scoped to the session company
* Leaflet detail map (marker, SSE movement, trail from the trip)
* Fleet map (`/fleet`): last positions in the viewport for the session company
* Route simulation (baked geometries, city/highway profile, fuel); pause per company (`GET`/`PATCH /api/sim`)
* Companies; users belong to exactly one company
* Session login
* Roles: `dispatcher` (write + sim pause) and `viewer` (read only)
* Tenant isolation: `company_id` from the session, never from the client body; plates unique per company; SSE and sim scoped to that company; trips via `trip → vehicle → company`
* API integration tests (`node:test` + SuperTest)

### Consciously simplified / demo

* Movement comes from the simulator, not GPS hardware
* Seed login is shown on the login page only in Vite `DEV` (`cihan@example.com` / `development-only-password`)
* SQLite file database
* One company per user (no membership table, no company switcher)
* Alerts: table + `active_alerts` count/filter only — no REST, no UI, seeded dummy rows
* OSM tiles via Leaflet

### Technical debt (not production-ready)

* Cookie session is correct for **same-origin** (Vite proxies `/api`). That is not production auth: no password reset, lockout, invite, or CSRF strategy for a cross-origin cookie deployment
* No frontend tests
* No CI/CD
* `CORS_ORIGIN` defaults to `*`; rate limiting is production-only (`NODE_ENV=production`)
* No retention policy for trips or raw telemetry
* No observability beyond request logs

### Roadmap (not implemented)

* Alerts REST/UI
* Invite / password reset / registration
* Optional multi-company membership
* Production database, CI/CD, observability
* Speed-limit alerts (need map-derived limits, not the sim’s 50/120 profile)

---

# Architecture

```text
fleet-live/
├── apps/
│   ├── api/          Express 5 + SQLite (node:sqlite)
│   └── web/          React 19 + Vite + React Router
└── packages/
    └── shared/       Domain types, Zod validation, list/SSE/auth contracts
```

```text
                    ┌─────────────────┐
                    │  React Frontend │
                    └────────┬────────┘
                             │
                    HTTP + SSE (/api)  cookie session
                             │
                             ▼
                    ┌─────────────────┐
                    │  Express API    │
                    └────────┬────────┘
                             │
                    ┌────────┴────────┐
                    ▼                 ▼
               Controllers         Models
                                      │
                                      ▼
                                   SQLite

                    ┌─────────────────┐
                    │ @fleet-live/shared │
                    └─────────────────┘
```

Routes/controllers handle HTTP. Models own SQL and do not take `req`/`res`. The UI never touches SQLite.

`@fleet-live/shared` is the contract. Do not duplicate vehicle, list-query, telemetry, stream or login schemas in api or web.

Company membership is read from the session. Child rows (telemetry, trips, alerts) hang off `vehicle_id`. HTTP access checks the vehicle’s company first. Trip reads also join `vehicles` (`trip → vehicle → company`). There is no `company_id` on `trips`.

---

# Tech Stack

**Backend:** Node.js, TypeScript, Express 5, SQLite (`node:sqlite`)

**Frontend:** React 19, TypeScript, Vite, React Router, Sass / CSS Modules, Leaflet

**Shared:** `@fleet-live/shared` — snake_case domain types, Zod, list/fleet/SSE/sim/auth contracts, polyline codec

**Development:** npm workspaces, tsx, ESLint, `node:test` + SuperTest (API), autocannon bench

---

# API

Vehicle, stream and sim routes require a session. `GET /api/health` does not. User-facing `error`/`fields` are German; `code` is English.

## Auth

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `POST` | `/api/auth/login` | `{ email, password, remember? }` — sets `fleet_session` |
| `POST` | `/api/auth/logout` | Clears the session |
| `GET`  | `/api/auth/me` | Current user (`id`, `name`, `email`, `company_id`) or `401` |

`remember: true` persists the cookie for seven days; otherwise the session lasts twelve hours (and the cookie is session-scoped). Wrong password returns `401` without saying which field failed.

## Vehicles and live data

| Method   | Endpoint                         | Description |
| -------- | -------------------------------- | ----------- |
| `GET`    | `/api/vehicles`                  | Paginated list (`search`, `filter`, `sort`, `dir`, `page`, `limit`) |
| `GET`    | `/api/vehicles/positions`        | Last positions for the fleet map (`bbox`, `search`, `filter`, `drivers`) |
| `GET`    | `/api/vehicles/drivers`          | Driver search (`search`, `page`; optional `names` hydrates a selection) |
| `GET`    | `/api/vehicles/:id`              | One vehicle (`404` if missing **or** other company) |
| `GET`    | `/api/vehicles/:id/telemetry`    | Recent points (`limit`: 10, 25, 50, 100; default 50) |
| `GET`    | `/api/vehicles/:id/trips/latest` | Running trip, else last finished (`data: null` if never driven) |
| `POST`   | `/api/vehicles`                  | Create (`Location` on `201`); `company_id` from the session |
| `PUT`    | `/api/vehicles/:id`              | Replace |
| `PATCH`  | `/api/vehicles/:id`              | Update |
| `DELETE` | `/api/vehicles/:id`              | Delete |
| `GET`    | `/api/stream`                    | SSE: `connected` (`connection_id`), telemetry, `vehicles-changed` |
| `POST`   | `/api/stream/focus`              | `{ connection_id, ids }` — only vehicles of this company; connection must belong to this company |
| `GET`    | `/api/sim`                       | `{ running, available }` for **this** company |
| `PATCH`  | `/api/sim`                       | `{ running }` — pause/resume this company’s simulation |
| `GET`    | `/api/health`                    | `{ status: "ok" }` |

`GET /api/vehicles` returns `{ data, meta }`. `meta` includes `total`, `pageCount` and facet `counts` (`all`, `alerts`, `low_fuel`, `driving`, `offline`).

`GET /api/vehicles/positions` returns `{ data, meta.truncated }` — slim last-known positions, not the list page. Optional `bbox=west,south,east,north`; `search` matches plate and driver; `drivers` is a view filter (empty means the company snapshot in the bbox, not “no markers”). Over `FLEET_POSITIONS_MAX` (2000) matches → `truncated` and empty `data` (no sample).

Query parameters live in `@fleet-live/shared`. Invalid sort keys or limits are `400`. Default page size `10`; allowed limits `10`, `25`, `50`, `100`. `license_plate` max 32 characters, `driver_name` max 80. Plates are unique **per company**.

Validation example:

```json
{
  "error": "Tankstand muss zwischen 0 und 100 liegen.",
  "code": "VALIDATION_ERROR",
  "fields": {
    "fuel_level": "Tankstand muss zwischen 0 und 100 liegen."
  }
}
```

Vehicle JSON includes last telemetry (or `null`) and `active_alerts`.

---

# Vehicle Model

Master data a person maintains: license plate and driver. `status` is what the vehicle reports (`DRIVING`, `IDLE`, `STOPPED`, `OFFLINE`) — not a form control. `fuel_level` is measured while `DRIVING`; otherwise it stays manually maintainable.

Responses also include last position/speed/`recorded_at`, `active_alerts`, and `created_at`.

`company_id` is assigned from the session on create. The client cannot choose it.

---

# Frontend

Vite proxies `/api` to `http://localhost:3000` so the browser uses same-origin `fetch` / EventSource with `credentials: "include"`.

List state lives in the URL. Reloading keeps the view; a fresh visit to `/vehicles` starts on page 1.

| Route           | Description |
| --------------- | ----------- |
| `/login`        | Session login |
| `/`             | Redirects to `/vehicles` (auth required) |
| `/vehicles`     | List and create dialog |
| `/vehicles/:id` | Detail, map/trail, edit, delete |
| `/fleet`        | Fleet map |

Unauthenticated visits to vehicle/fleet routes go to `/login`.

## Vehicle list

Generic table; vehicle columns/filters are configuration, not table internals. Search, filters, sort and pagination run **on the server**. Live patches apply to the current page plus neighbours.

## Vehicle management

Create, edit, delete. Status is a badge. Fuel is read-only while driving. The header pauses/resumes **this company’s** simulator and switches list ↔ map.

## Fleet map

`/fleet` loads last positions for the **session company** in the visible bbox. The driver picker is an optional view filter, not a requirement. Status chips and plate search apply to that snapshot. More than 2000 matches → no markers (`truncated`), not a sample. **Fahrer** is a modal (`driver_name`, one vehicle each). Driving vehicles in the snapshot get SSE ticks (focus cap 150). No trails here — the path stays on the detail page.

See [apps/docs/table.md](apps/docs/table.md) for the table component.

---

# Telemetry

Hot buffer: vehicle, latitude, longitude, speed, `recorded_at`. Last point is on the vehicle JSON. `GET /api/vehicles/:id/telemetry` returns `{ data }` in chronological order — marker and newest movement, not the trail.

A ticker writes only for focused `DRIVING` vehicles whose company has not paused the sim. The `connected` event includes `connection_id`. The UI posts `{ connection_id, ids }` (list page plus neighbours, open detail vehicle, driving vehicles on the fleet map). Each connection has its own focus; the ticker uses the union **of that company’s running simulations**. Without focus, nothing is written. Telemetry patches go only to connections that focused that id **and** belong to the same company. `vehicles-changed` goes only to that company’s connections.

At most `TELEMETRY_KEEP_PER_VEHICLE` raw rows remain per vehicle (default 100). Ending a trip writes speed `0` at the last position.

Focused `DRIVING` vehicles follow baked OSRM polylines. Speed follows a city/highway profile with light noise. A time scale keeps a typical corridor in the 1–2 minute range.

## Trips

A trip is the durable record of one drive. A rolling window of raw points is the wrong unit for a route: visible length would depend on tick rate, not on the drive.

Each reported position is appended to `trips.path` as an [encoded polyline](https://developers.google.com/maps/documentation/utilities/polylinealgorithm) (precision 5):

* **Append is O(1)** (`path = path || ?`; predecessor in `last_latitude` / `last_longitude`). Points closer than 20 m are dropped.
* **Close simplifies** with Ramer-Douglas-Peucker at 12 m.
* **`distance_m`** is the sum of reported segments, not the simplified line.

Access is `trip → vehicle → company`. There is no `company_id` on `trips` and no `GET /api/trips/:id`.

Deliberate trade-offs:

* No per-point speed or time on the polyline; aggregates live on the trip.
* Distance and top speed are shown for finished trips only (fetched once).
* The row is rewritten on every append; chunking would be the fix at larger scale.
* No retention policy yet (technical debt, not a missing tenant column).

---

# Alerts

The `alerts` table and `active_alerts` on the vehicle exist. The list can filter and highlight by that count.

There is **no** `GET /api/alerts` and no alerts UI. Seeded rows are demo data.

**Optional later:** speeding and similar types need map-derived speed limits, not the simulator profile. Live speed stays in the telemetry window; the trip polyline has no per-point speed.

---

# Database

```text
companies
users          → company_id
sessions       → user_id
vehicles       → company_id   UNIQUE (company_id, license_plate)
telemetry      → vehicle_id
trips          → vehicle_id   (one open trip per vehicle)
alerts         → vehicle_id
```

A partial unique index on `trips(vehicle_id) WHERE ended_at IS NULL` enforces one drive at a time.

---

# Authentication and tenants

Implemented:

* Login / logout / me
* scrypt password hashes
* HttpOnly session cookie
* Isolation by `company_id` on the user (one company per account)
* Roles: `dispatcher` may mutate vehicles and pause the sim; `viewer` may only read
* SSE connections and sim pause bound to that company

Not the same as production auth: no reset, lockout, invite, roles, or multi-company membership. CORS `*` is a local default; cookies work because the Vite proxy is same-origin.

---

# Local Development

## Requirements

* Node.js
* npm

```bash
npm install
npm run dev
```

API only: `npm run dev:api`. Web only: `npm run dev:web`.

Seed:

```bash
npm run db:seed
```

Large set (tens of thousands of vehicles, unique plates and driver names):

```bash
npm run db:seed:large
```

API tests:

```bash
npm test
```

List-query bench: `npm run bench` (see `apps/api/scripts/bench.ts`).

After `db:seed`, in development the login page can fill `cihan@example.com` / `development-only-password` (dispatcher, Rheinland Logistik). `viewer@example.com` uses the same password and can only read. Seed also creates companies 2 and 3 and spreads vehicles across them.

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `PORT` | `3000` | |
| `DATABASE_PATH` | `apps/api/data/fleetlive.db` | `:memory:` in tests |
| `CORS_ORIGIN` | `*` | Same-origin in dev via Vite proxy |
| `TELEMETRY_TICK_MS` | `400` | `0` disables the simulator |
| `TELEMETRY_BATCH_SIZE` | `32` | Cap per tick on the union of focus ids |
| `TELEMETRY_KEEP_PER_VEHICLE` | `100` | Live buffer only |
| `LOG_LEVEL` | `info` | |
| `NODE_ENV` | `development` | Rate limiting is production-only |

---

# Example: login then create a vehicle

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "cihan@example.com",
  "password": "development-only-password",
  "remember": true
}
```

```http
POST /api/vehicles
Content-Type: application/json
Cookie: fleet_session=…

{
  "license_plate": "K-XY 123",
  "driver_name": "Max Mustermann",
  "fuel_level": 85,
  "status": "DRIVING"
}
```

`company_id` in the body is ignored.

---

# API Design

```text
Routes → Controllers → Models → SQLite
```

Controllers validate and map HTTP. Models run SQL. This stays intentionally thin.

---

# Current Limitations

Not production-ready. Incomplete by design:

* Production-grade auth (reset, lockout, CSRF for cross-origin cookies)
* Multi-company users
* Alerts REST/UI
* Frontend tests
* CI/CD, production database, observability
* Trip/telemetry retention
* CORS/rate-limit hardening for a real deployment

---

# Roadmap

## Phase 1 — Vehicles

* [x] Schema, vehicle model, CRUD, validation, seed

## Phase 2 — Frontend

* [x] Server-driven list, detail, create/edit/delete, no mock data

## Phase 3 — Map and live position

* [x] Telemetry history, detail map, SSE movement, trip trail, route sim, fleet map `/fleet`

## Phase 4 — Companies, login, isolation

* [x] Company model
* [x] User belongs to one company
* [x] Session login
* [x] Tenant isolation (`company_id` from session; plates unique per company; SSE and sim scoped; trips via vehicle)
* [x] Roles (`dispatcher` writes; `viewer` reads)
* [ ] Per-tenant retention for trips and telemetry

## Phase 5 — still open

Phase 4 already isolates data by company. What remains is product and operations, not a second isolation rewrite:

* [ ] Alerts REST/UI
* [ ] Invite / password reset
* [ ] Optional multi-company membership
* [ ] Frontend tests, CI/CD, production database, observability

## Optional

* [ ] Speed-limit alerts. Needs map-derived limits; do not treat the sim’s 50/120 profile as legal limits.

---

# Project Status

**Work in progress.** Personal full-stack project: vehicle API first, then UI, live map, then login and company isolation. Treat it as an evolving codebase, not a product you would give a dispatcher tomorrow.

If README and code disagree, **code wins**. Agent notes: `.cursor/rules/architecture.mdc`, `AGENTS.md`.

---

## Why this project?

Closer to a real application than a tutorial. The domain covers REST, relational data, TypeScript, frontend/backend split, maps, SSE, simulation, sessions and tenant isolation.
