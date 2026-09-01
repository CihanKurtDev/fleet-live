# fleet-live 🚚

A full-stack fleet management application built with **TypeScript, Node.js, Express, React and SQLite**.

> **Status: Work in progress.** Live SPEEDING warnings, an inbox with type filters, fleet map, trip trails, and company login are in place. GPS is simulated.

This is closer to a real fleet system than a tutorial: server-driven lists, SSE with per-connection focus, trips as encoded polylines, and tenant isolation by company. SPEEDING warnings are live ticker events (8 s over the current sim road-class limit); list colour uses the same limit. LOW_FUEL and OFFLINE remain seeded.

---

## Overview

`fleet-live` monitors vehicles, last positions, live movement and trip paths for **one company per logged-in user**.

The React UI talks to the Express API over HTTP and SSE (`/api`). Unauthenticated vehicle, stream, sim and alert requests are `401`. Other companies’ vehicles are `404`, not listed.

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
* Roles: `dispatcher` (write + sim pause + resolve alerts) and `viewer` (read only)
* Tenant isolation: `company_id` from the session, never from the client body; plates unique per company; SSE and sim scoped to that company; trips via `trip → vehicle → company`
* Alerts REST (`GET`/`PATCH /api/alerts`) and UI (inbox `/alerts` with open/resolved and `type` chips); live SPEEDING events from the ticker; `ended_at` / `details`; `active_alerts` on the vehicle
* Drivers as entities (`drivers` table, `vehicle.driver_id`); list/detail `/drivers` with incident counts
* Live speed indicator (`speedBand`: orange over the current `speed_limit_kmh` until the event opens, red while `speeding_open`)
* API integration tests (`node:test` + SuperTest)

### Consciously simplified / demo

* Movement comes from the simulator, not GPS hardware
* Seed login is shown on the login page only in Vite `DEV`: `cihan@example.com` (dispatcher) and `viewer@example.com` (read-only), both `development-only-password`, both company 1
* Companies 2 and 3 exist in seed for isolation. There is no demo login for them — cross-tenant checks are API tests, or a company-1 user opening another company’s vehicle id (`404`)
* SQLite file database
* One company per user (no membership table, no company switcher)
* Alerts: SPEEDING is written by the ticker (one open row per vehicle); LOW_FUEL/OFFLINE are still seed-only. Not OSM, not a general rule engine
* Live tempo colour uses the current sim road-class limit (`speedBand` + `speed_limit_kmh` + `speeding_open`) — not map/OSM limits. A minority of simulated vehicles exceed their class so SPEEDING still fires. No low-speed colour
* OSM tiles via Leaflet

### Technical debt (not production-ready)

* Cookie session is correct for **same-origin** (Vite proxies `/api`). That is not production auth: no password reset, lockout, invite, or CSRF strategy for a cross-origin cookie deployment. Before splitting web and API onto different hosts, set `CORS_ORIGIN` to the web origin and allow credentials — do not switch to JWT for that
* An expired session is detected on load (`GET /api/auth/me`). Later `401`s do not send the UI back to `/login`
* Sim pause is in-memory per company; an API restart resumes every tenant
* No frontend tests
* No CI/CD
* `CORS_ORIGIN` defaults to `*`; rate limiting is production-only (`NODE_ENV=production`) and is not login-specific
* No observability beyond request logs

### Coming next

What dispatchers will notice in the product — not an engineering backlog:

* Tank and no-signal warnings while vehicles are out (today only speeding is live)
* A briefing on the home page, and the open-warning count in the nav
* Past trips on the vehicle, not only the current drive
* Yard fields such as VIN, HU, depot; drivers you can maintain without the vehicle form
* A fleet map that still orients when many vehicles are in view; plate search that jumps to the marker
* Depot geofences, due-date reminders (HU, licence, UVV), and a CSV for the boss

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

Company membership is read from the session. Child rows (telemetry, trips, alerts) hang off `vehicle_id`. Drivers hang off `company_id`; vehicles point at `driver_id`. HTTP access checks the vehicle’s or driver’s company first. Trip reads also join `vehicles` (`trip → vehicle → company`). There is no `company_id` on `trips` or `alerts`.

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
| `GET`  | `/api/auth/me` | Current user (`id`, `name`, `email`, `company_id`, `role`) or `401` |

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
| `GET`    | `/api/alerts`                    | Paginated alerts (`filter` open/resolved/all, optional `type`, `vehicle_id`, `driver_id`, `page`, `limit`) |
| `PATCH`  | `/api/alerts/:id`                | `{ resolved: true }` — close; `dispatcher` only |
| `GET`    | `/api/drivers`                   | Paginated drivers (`search`, `page`, `limit`) with type counts |
| `GET`    | `/api/drivers/:id`               | Driver, vehicles, incident counts (`404` if missing **or** other company) |
| `GET`    | `/api/health`                    | `{ status: "ok" }` |

`GET /api/vehicles` returns `{ data, meta }`. `meta` includes `total`, `pageCount` and facet `counts` (`all`, `alerts`, `low_fuel`, `driving`, `offline`).

`GET /api/alerts` returns `{ data, meta }` of alerts joined with plate, driver name and `driver_id`. Rows include `ended_at` and `details` (SPEEDING: `{ limit_kmh, max_speed_kmh, duration_s }`). Default `filter=open` is `resolved_at IS NULL` (independent of `ended_at`). Optional `type` is `SPEEDING` / `LOW_FUEL` / `OFFLINE` (omit = all types). `meta.counts` is `open` / `resolved` / `all` and ignores `type`. `meta.type_counts` is per-type and respects `filter`. Optional `vehicle_id` or `driver_id` (404 if missing or other company).

`GET /api/drivers` returns `{ data, meta }` of drivers for the session company. Counts include **all** alert rows (open and resolved). `open_warnings` is the unresolved subset. `vehicle_plate` is set when the driver has exactly one vehicle. `GET /api/drivers/:id` adds assigned vehicles.

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

Vehicle JSON includes last telemetry (or `null`), `speed_limit_kmh`, `active_alerts`, `speeding_open` (unfinished SPEEDING event), and `driver_id`. Write API still takes `driver_name`; the model upserts a driver in that company.

---

# Vehicle Model

Master data a person maintains: license plate and driver. `status` is what the vehicle reports (`DRIVING`, `IDLE`, `STOPPED`, `OFFLINE`) — not a form control. `fuel_level` is measured while `DRIVING`; otherwise it stays manually maintainable.

Responses also include last position/speed/`speed_limit_kmh`/`recorded_at`, `active_alerts`, `speeding_open`, and `created_at`.

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
| `/vehicles/:id` | Detail, map/trail, alerts, edit, delete |
| `/fleet`        | Fleet map |
| `/alerts`       | Warning inbox (open/resolved, optional `type`, `vehicle_id` / `driver_id`) |
| `/drivers`      | Driver list (incident counts) |
| `/drivers/:id`  | Driver detail, vehicles, violation history |

Unauthenticated visits to vehicle, fleet, alert and driver routes go to `/login`.

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

At most `TELEMETRY_KEEP_PER_VEHICLE` raw rows remain per vehicle (default 100). That **is** the telemetry retention. Ending a trip writes speed `0` at the last position.

Focused `DRIVING` vehicles follow baked OSRM polylines. Speed follows a city/highway profile with light noise. A time scale keeps a typical corridor in the 1–2 minute range.

## Trips

A trip is the durable record of one drive. A rolling window of raw points is the wrong unit for a route: visible length would depend on tick rate, not on the drive.

Each reported position is appended to `trips.path` as an [encoded polyline](https://developers.google.com/maps/documentation/utilities/polylinealgorithm) (precision 5):

* **Append is O(1)** (`path = path || ?`; predecessor in `last_latitude` / `last_longitude`). Points closer than 20 m are dropped.
* **Close simplifies** with Ramer-Douglas-Peucker at 12 m.
* **`distance_m`** is the sum of reported segments, not the simplified line.

Access is `trip → vehicle → company`. There is no `company_id` on `trips` and no `GET /api/trips/:id`.

Closed trips older than `TRIP_RETENTION_DAYS` (default 90) are deleted **per company**. Open trips stay. Prune runs after a trip is closed and after a telemetry tick for companies in that batch. `TRIP_RETENTION_DAYS=0` turns prune off.

Deliberate trade-offs:

* No per-point speed or time on the polyline; aggregates live on the trip.
* Distance and top speed are shown for finished trips only (fetched once).
* The row is rewritten on every append; chunking would be the fix at larger scale.

---

# Alerts, warnings, violations

Three layers share the same `alerts` rows; they are not three tables:

* **Indicator** — `speedBand` plus `speeding_open`. Orange while over the current `speed_limit_kmh` without an open event; red while a SPEEDING row has `ended_at` null. Only `DRIVING`. After the event ends the cell is normal even if the inbox row is still unresolved.
* **Warning** — `alerts` where `resolved_at IS NULL`. Operative inbox `/alerts`. Dispatcher acknowledges with `PATCH`. Event end (`ended_at`) is not the same as resolved.
* **Violation history** — all `alerts` rows, including resolved. Counted per driver on `/drivers`. `resolved_at` means “seen”, not “did not happen”.

The `alerts` table hangs off `vehicle_id`. Access is `alert → vehicle → company`. `driver_id` on the DTO is the vehicle’s current driver (join). `active_alerts` is the unresolved count (triggers) and remains on the vehicle JSON and list filter.

`GET /api/alerts` is the company inbox (`{ data, meta }`). Default `filter=open`. Optional `type` (`SPEEDING` / `LOW_FUEL` / `OFFLINE`), `vehicle_id` or `driver_id` (404 if missing or another company). `PATCH /api/alerts/:id` with `{ resolved: true }` closes a row (`dispatcher`). A second close is idempotent. Viewer may read, not resolve. After a close the API broadcasts `vehicles-changed` so the list count updates.

The ticker writes SPEEDING: 8 s consecutive over the current sim road-class limit (`speedLimitKmh`: city 50 / highway 120), one open row per vehicle (`ended_at` null), `details` with limit / max / duration; 2 s hysteresis or leaving `DRIVING` sets `ended_at`. Every 8th simulated vehicle may exceed its class so events still occur. Seed still inserts LOW_FUEL/OFFLINE only. The inbox event line is `formatAlertEvent` (`type` + `details`, else `message`). Driver names in the tables link to `/drivers/:id`; row click on a warning still opens the vehicle.

Live speed stays in the telemetry window; the trip polyline has no per-point speed.

---

# Drivers

`drivers` is a real entity (`UNIQUE (company_id, name)`). Vehicles keep denormalized `driver_name` for search and forms; `driver_id` is the stable link. Creating or renaming a vehicle upserts a driver in the session company. A new name creates a new row; the old driver remains.

`GET /api/drivers` and `GET /api/drivers/:id` aggregate incident counts (all alert types, including resolved) and open warnings. Isolation is still company. `GET /api/vehicles/drivers` remains the fleet-map name picker, not this roster.

---

# Database

```text
companies
users          → company_id
sessions       → user_id
drivers        → company_id   UNIQUE (company_id, name)
vehicles       → company_id, driver_id   UNIQUE (company_id, license_plate)
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
* Roles: `dispatcher` may mutate vehicles, pause the sim and resolve alerts; `viewer` may only read (including inbox, drivers, indicators)
* SSE connections and sim pause bound to that company

Not the same as production auth: no reset, lockout, invite, or multi-company membership. CORS `*` is a local default; cookies work because the Vite proxy is same-origin. A split-host deploy needs an explicit origin plus credentialed CORS, not a token redesign.

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

After `db:seed`, in development the login page can fill `cihan@example.com` / `development-only-password` (dispatcher, Rheinland Logistik). `viewer@example.com` uses the same password and can only read. Both accounts are company 1. Sample seed still creates vehicles for companies 2 and 3, but those firms have no demo user — isolation in the UI is a foreign vehicle id returning “not found”. `db:seed:large` puts almost all vehicles on company 1 so the demo login sees the load; companies 2 and 3 get about 1 % each for isolation tests. Existing databases that were only migrated (no reseed) keep every old vehicle on company 1.

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `PORT` | `3000` | |
| `DATABASE_PATH` | `apps/api/data/fleetlive.db` | `:memory:` in tests |
| `CORS_ORIGIN` | `*` | Same-origin in dev via Vite proxy |
| `TELEMETRY_TICK_MS` | `400` | `0` disables the simulator |
| `TELEMETRY_BATCH_SIZE` | `32` | Cap per tick on the union of focus ids |
| `TELEMETRY_KEEP_PER_VEHICLE` | `100` | Live buffer only |
| `TRIP_RETENTION_DAYS` | `90` | Closed trips older than this, per company; `0` disables |
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

Not production-ready:

* Cookie session is same-origin only; no password reset, lockout, or invite
* Sim pause lives in process memory; an API restart resumes every tenant
* Fleet map draws nothing when the viewport exceeds `FLEET_POSITIONS_MAX`
* No frontend tests, CI/CD, production database, or observability
* CORS `*` is a local default; a split-host deploy needs an explicit origin plus credentials
* One company per user (no membership table, no company switcher)

---

# Project Status

**Work in progress.** Live-ops core is in place: SPEEDING follows the sim road class, and the inbox filters by type. If README and code disagree, **code wins**. Agent notes: `.cursor/rules/architecture.mdc`, `AGENTS.md`.

---

## Why this project?

Closer to a real application than a tutorial. The domain covers REST, relational data, TypeScript, frontend/backend split, maps, SSE, simulation, sessions and tenant isolation.
