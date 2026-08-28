# fleet-live 🚚

A full-stack fleet management application built with **TypeScript, Node.js, Express, React and SQLite**.

The project is being developed incrementally, starting with the backend and domain model, followed by the frontend and eventually vehicle visualization, multi-tenancy and authentication.

> **Status: Work in progress**

This is a personal development project focused on learning and applying full-stack software engineering concepts through a realistic application rather than a tutorial-sized example.

---

## Overview

`fleet-live` is intended to become a fleet management application for monitoring vehicles, their locations, telemetry and alerts.

The application is being developed in several stages.

The **vehicle REST API**, **server-driven vehicle list**, **live telemetry stream**, the **detail map** (marker, live movement, trail) and the **fleet map** (`/fleet`) are connected to the React UI.

Future iterations will add:

* Companies and users
* Authentication and authorization
* Multi-tenant data isolation

The project is intentionally being developed step by step rather than implementing all of these concerns at once.

---

## Current Status

The backend serves paginated vehicle queries over SQLite, and the frontend talks to that API. Driving vehicles receive simulated telemetry over SSE.

### Implemented

* TypeScript backend
* Express API
* SQLite database (WAL, statement cache, lightweight migrations)
* Vehicle model
* Vehicle CRUD API
* Server-driven list query (search, filter, sort, pagination, facet counts)
* Input validation
* HTTP status handling and structured API errors
* Database relationships
* Telemetry data model
* Alert data model
* Development seed data (small and large)
* Health endpoint
* SSE telemetry stream with per-connection focus
* Telemetry history API (rolling window per vehicle)
* Trip data model with the driven path as an encoded polyline
* Separate frontend and API applications
* Shared domain package for types, validation and list query contract
* Field-level validation errors in API responses
* Last telemetry and active alert count in vehicle responses
* React frontend with client-side routing
* Generic, reusable table component
* Vehicle list backed by the API (URL state, cache, prefetch, skeleton)
* Live table and detail updates for focused driving vehicles
* Vehicle detail page
* Create, edit and delete vehicle UI
* Leaflet map on the vehicle detail page (marker, SSE movement, trail from the trip)
* Fleet map (`/fleet`): last positions in the viewport, live movement for driving vehicles in view
* Trips: the driven path stored per trip as an encoded polyline, simplified when the trip ends
* Simulated movement on baked road geometries with a city/highway speed profile
* Simulated fuel consumption while driving
* Simulation pause/resume (`GET`/`PATCH /api/sim`)
* API integration tests (`node:test` + SuperTest)

### Planned

* Companies / tenants
* User accounts
* Authentication
* Authorization
* Tenant-level data isolation

---

# Architecture

The repository is structured as a small monorepo containing separate frontend and backend applications plus a shared package.

```text id="7m7g6m"
fleet-live/
├── apps/
│   ├── api/
│   │   └── src/
│   │       ├── controllers/
│   │       ├── db/
│   │       ├── middleware/
│   │       ├── models/
│   │       ├── routes/
│   │       ├── sse/
│   │       ├── test/
│   │       ├── app.ts
│   │       ├── config.ts
│   │       └── server.ts
│   │
│   └── web/
│       └── src/
│           ├── api/
│           ├── components/
│           │   ├── ui/
│           │   └── vehicles/
│           ├── context/
│           ├── hooks/
│           ├── pages/
│           ├── types/
│           ├── utils/
│           └── router.tsx
│
├── packages/
│   └── shared/
│       └── src/
│           └── models/
│
└── package.json
```

The intended architecture is:

```text id="c0xg5w"
                    ┌─────────────────┐
                    │  React Frontend │
                    │     (web)       │
                    └────────┬────────┘
                             │
                    HTTP + SSE (/api)
                             │
                             ▼
                    ┌─────────────────┐
                    │  Express API    │
                    │     (api)       │
                    └────────┬────────┘
                             │
                    ┌────────┴────────┐
                    │                 │
                    ▼                 ▼
               Controllers         Models
                                      │
                                      ▼
                                   SQLite


                    ┌─────────────────┐
                    │  Shared package │
                    │    (shared)     │
                    └─────────────────┘
                 used by both web and api
```

The API is separated into routes, controllers and models to keep HTTP handling and database access separated.

The shared package contains the vehicle domain types and the input validation used by both the API and the frontend, so that both sides agree on the same rules.

---

# Tech Stack

## Backend

* Node.js
* TypeScript
* Express 5
* SQLite

## Frontend

* React
* TypeScript
* Vite
* React Router
* Sass / CSS Modules

## Shared

* `@fleet-live/shared` npm workspace package
* Vehicle domain types (snake_case)
* Vehicle input validation (Zod, max lengths)
* Vehicle list query and telemetry history contract
* SSE focus contract (`connection_id`)

## Development

* npm Workspaces
* tsx
* ESLint
* TypeScript
* node:test + SuperTest (API)
* autocannon bench script

---

# Vehicle API

The first development milestone is a reliable REST API for vehicle management.

## Endpoints

| Method   | Endpoint                        | Description                                      |
| -------- | ------------------------------- | ------------------------------------------------ |
| `GET`    | `/api/vehicles`                 | Paginated vehicle list (`search`, `filter`, `sort`, `dir`, `page`, `limit`) |
| `GET`    | `/api/vehicles/positions`       | Last positions for the fleet map (`bbox`, `search`, `filter`) |
| `GET`    | `/api/vehicles/drivers`         | Search drivers (`search`, `page`; `meta.total` is the match count; optional `names` hydrates a selection) |
| `GET`    | `/api/vehicles/:id`             | Get a vehicle                                    |
| `GET`    | `/api/vehicles/:id/telemetry`   | Recent telemetry points (`limit`: 10, 25, 50, 100; default 50) |
| `GET`    | `/api/vehicles/:id/trips/latest`| Running trip, else the last finished one (`data: null` if never driven) |
| `POST`   | `/api/vehicles`                 | Create a vehicle (`Location` header on `201`)    |
| `PUT`    | `/api/vehicles/:id`             | Replace a vehicle                                |
| `PATCH`  | `/api/vehicles/:id`             | Update a vehicle                                 |
| `DELETE` | `/api/vehicles/:id`             | Delete a vehicle                                 |
| `GET`    | `/api/stream`                   | SSE: `connected` (with `connection_id`), telemetry patches, `vehicles-changed` |
| `POST`   | `/api/stream/focus`             | `{ connection_id, ids }` — focus for that SSE connection |
| `GET`    | `/api/sim`                      | Simulator ticker: `{ running, available }`       |
| `PATCH`  | `/api/sim`                      | `{ running }` — pause or resume the ticker       |
| `GET`    | `/api/health`                   | Check API health                                 |

`GET /api/vehicles` returns `{ data, meta }`. `meta` includes `total`, `pageCount` and facet `counts` for the filter chips (`all`, `alerts`, `low_fuel`, `driving`, `offline`).

`GET /api/vehicles/positions` returns `{ data, meta.truncated }` — slim last-known positions (`id`, `license_plate`, `driver_name`, `status`, `latitude`, `longitude`, `speed`, `recorded_at`), not the paginated list. Optional `bbox=west,south,east,north` limits the query to the visible map; `search` matches plate and driver (same as the list); `drivers` is a list of `driver_name` values (`drivers=Anna&drivers=Max` or comma-separated; empty means all); `filter` uses the same ids as the list. Vehicles without telemetry are omitted. If more than `FLEET_POSITIONS_MAX` (2000) would match, `truncated` is true and `data` is empty — the map does not show an arbitrary sample. At most `FLEET_DRIVERS_MAX` (50) names per query.

Query parameters are defined once in `@fleet-live/shared` (`vehicleListQuerySchema`). Invalid sort keys or limits are rejected with `400`. Sort keys and filters are snake_case (`active_alerts`, `low_fuel`). Default page size is `10`; allowed limits are `10`, `25`, `50` and `100`.

`license_plate` is limited to 32 characters, `driver_name` to 80. User-facing `error` and `fields` are German; `code` stays machine-readable (`VALIDATION_ERROR`, `CONFLICT`, …).

The API performs request validation and returns appropriate HTTP status codes for invalid requests, missing resources and conflicts.

Validation errors are returned with the offending fields so that a client can display them next to the corresponding input:

```json id="4k2m9v"
{
  "error": "Tankstand muss zwischen 0 und 100 liegen.",
  "code": "VALIDATION_ERROR",
  "fields": {
    "fuel_level": "Tankstand muss zwischen 0 und 100 liegen."
  }
}
```

Vehicle responses also include the most recent telemetry record and the number of unresolved alerts.

---

# Vehicle Model

Vehicles currently contain information such as:

* License plate
* Driver
* Fuel level
* Status
* Creation timestamp

Only license plate and driver are master data a person maintains. `status` is what the vehicle reports (`DRIVING`, `IDLE`, `STOPPED`, `OFFLINE`) and is changed through starting or ending a trip, not by picking a value in a form. `fuel_level` is a measurement while the vehicle is driving; for vehicles without live reporting it stays manually maintainable.

Vehicle responses additionally contain:

* Latitude, longitude, speed and timestamp of the last telemetry record
* `active_alerts` — the number of currently unresolved alerts
* `created_at`

The telemetry fields are `null` while a vehicle has no telemetry data yet.

The current database model is intentionally simple.

The goal of the first development stage is to establish reliable vehicle CRUD operations before introducing more complex business concepts.

---

# Frontend

The frontend is a React application for managing the vehicle fleet.

Vite proxies `/api` to `http://localhost:3000` so the browser can use same-origin requests and EventSource.

List state (search, filter, sort, page, limit) lives in the URL. Reloading keeps the current view; a fresh visit to `/vehicles` starts on page 1.

## Routes

| Route           | Description                          |
| --------------- | ------------------------------------ |
| `/`             | Redirects to the vehicle list        |
| `/vehicles`     | Vehicle list and creation dialog     |
| `/vehicles/:id` | Vehicle details, map/trail, editing and removal |
| `/fleet`        | Fleet map (last positions, live movement) |

## Vehicle list

The vehicle list is built on a generic table component that receives its columns and filters through a configuration and contains no vehicle-specific logic itself.

Search, filters, sorting and pagination run **on the server**. The table renders the current page, facet counts from `meta`, a loading skeleton while the API is unreachable (for example during a restart), and live telemetry patches for the current page plus neighbouring pages.

It supports:

* Search across license plate and driver (`search_text`)
* Filters for alerts, low fuel, driving and offline vehicles
* Sorting per column (allowlisted keys)
* Pagination
* Selecting rows and deleting several vehicles at once

## Vehicle management

Vehicles can be created, edited and deleted through the UI.

The edit form only covers master data. Status is a badge (what the vehicle reports), not a control. Fuel is read-only while driving. The header can pause or resume the simulator and switches between the vehicle list and the fleet map.

The forms validate their input with the same validation function the API uses, which comes from the shared package.

## Fleet map

`/fleet` shows last-known positions for the drivers you pick, in the visible map — not the current list page and not the whole fleet. Status chips and plate search stay off until that selection exists. If the viewport has more than 2000 matches, the map shows no markers — it does not paint a random sample. **Fahrer** opens a modal to pick people (`driver_name`, one vehicle each) by name or plate. That is a view filter, not a saved group. The toolbar shows how many markers are in the snapshot. Driving vehicles in that snapshot receive live SSE ticks (same focus mechanism as the list, capped at 150). There is no trail here — the driven path stays on the detail page. Click a marker to open the vehicle.

See [apps/docs/table.md](apps/docs/table.md) for a detailed description of the table component.

---

# Telemetry

The database already contains a telemetry model associated with vehicles.

Telemetry data includes information such as:

* Vehicle
* Latitude
* Longitude
* Speed
* Recorded timestamp

The last telemetry record of a vehicle is included in the vehicle API responses.

`GET /api/vehicles/:id/telemetry` returns the recent points as `{ data }` in chronological order. That is the live buffer (marker, newest movement), not the trail — the trail comes from `GET /api/vehicles/:id/trips/latest`.

A ticker writes new points only for focused vehicles with status `DRIVING`. The SSE `connected` event includes a `connection_id`. The frontend posts `{ connection_id, ids }` to `POST /api/stream/focus` (visible list page plus neighbours, the open detail vehicle, and driving vehicles on the fleet map). Each connection has its own focus list; the ticker uses the union. Without focus, nothing is written. Telemetry patches are delivered only to connections that included the vehicle in their focus. `vehicles-changed` is still sent to every open stream.

After each insert, older points of that vehicle are deleted so at most `TELEMETRY_KEEP_PER_VEHICLE` rows remain (default 100). Raw telemetry is only the live buffer for the marker and the newest movement — the driven path lives on the trip (see below), so this limit no longer decides how much of the route is visible.

Ending a trip writes a final point with speed `0` at the last known position, so a parked vehicle does not keep its cruising speed.

Focused `DRIVING` vehicles follow baked OSRM polylines (no routing at runtime). Progress is distance along the route from a city/highway/city speed profile; displayed km/h tracks that limit with light noise. A time scale keeps a typical corridor in the 1–2 minute range.

## Trips

A trip is the durable record of one drive: it opens when a vehicle starts driving and closes when it stops.

The problem it solves: a rolling window of raw points is the wrong unit for a route. How many kilometres it covers depends on the reporting interval and the speed, not on the drive, so the trail visibly crawls away behind a vehicle on a long haul — and forwarding companies drive hundreds of kilometres.

The number of vertices needed to *draw* a path is not proportional to its length. A 300 km motorway run is geometrically simple. So each reported position is appended to `trips.path` as an [encoded polyline](https://developers.google.com/maps/documentation/utilities/polylinealgorithm) (precision 5, roughly 6 bytes per point) and the raw row is free to expire:

* **Appending is O(1).** The row keeps its last point in `last_latitude` / `last_longitude`, because polyline deltas need the predecessor. The string grows in SQL (`path = path || ?`), so the existing path is never read back into Node. Positions closer than 20 m to the previous one are dropped as noise.
* **Closing simplifies.** On stop the path is decoded, run through Ramer-Douglas-Peucker at 12 m (below the width of a motorway, so the drawn line does not change) and re-encoded. Motorway legs shrink by roughly an order of magnitude.
* **`distance_m` stays the sum of the reported segments**, not the length of the simplified line. The vehicle drove the full distance.

A 300 km trip is therefore one row of a few KB and one request, instead of thousands of rows and a guessed `LIMIT`. The detail map reads `GET /api/vehicles/:id/trips/latest` once and extends the line from the SSE stream.

Deliberate trade-offs:

* A polyline carries no per-point speed or timestamp. Detail resolution stays in the live window; the trip keeps `distance_m` and `max_speed`, which is what a fleet report asks for.
* Distance and top speed are shown for finished trips only. They are fetched once, so during a drive the numbers would sit frozen on screen.
* The row is rewritten on every append. At this scale that is fine; if it ever hurts, the fix is chunking the path into append-only segment rows.
* No route-level retention policy yet. Trips are small, but a per-tenant retention rule belongs to Phase 4, where the data becomes company-owned and legally relevant.

The intended flow is:

```text id="y6js5u"
Vehicle
   │
   ▼
Telemetry
   │
   ├── Latitude
   ├── Longitude
   ├── Speed
   └── Timestamp
          │
          ▼
     API / Simulator
          │
          ▼
       Frontend
          │
          ▼
          Map
```

Vehicles appear on the detail map and on the fleet map, and move over time without real GPS hardware.

---

# Alerts

The database also contains an alert model associated with vehicles.

Alerts are intended to represent events such as abnormal vehicle behaviour or other conditions that should be surfaced to users.

The number of unresolved alerts per vehicle is already exposed through the vehicle API and used in the frontend to highlight and filter affected vehicles.

There is no alerts REST API or UI yet — only `active_alerts` on the vehicle.

**Optional later:** speeding (and similar driving events) as alert types. That needs a real speed limit per road segment (map data), not the simulator’s city/highway profile. The trip polyline has no per-point speed; live speed stays in the telemetry window.

---

# Database

SQLite is currently used as the database.

The current schema contains:

```text id="8d0q3g"
users
vehicles
telemetry
trips
alerts
```

Vehicles are related to telemetry, trips and alerts through foreign keys.

A partial unique index on `trips(vehicle_id) WHERE ended_at IS NULL` keeps the "one drive at a time" rule in the database rather than in the order of controller calls.

The database also contains indexes for frequently accessed telemetry data.

A development seed script is provided to create example data.

---

# Development Approach

The project is intentionally being developed incrementally.

Instead of implementing authentication, companies and multi-tenancy immediately, the focus is on getting the underlying vehicle and map functionality correct first.

The planned development path is:

```text id="qf5k7h"
1. Vehicle API
       ↓
2. Vehicle frontend
       ↓
3. API integration + live telemetry
       ↓
4. Map (detail marker, live movement, fleet view)
       ↓
5. Companies
       ↓
6. Users
       ↓
7. Authentication
       ↓
8. Authorization & multi-tenancy
```

This order keeps the complexity manageable and allows each layer to be tested before adding the next one.

---

# Multi-Tenancy

Multi-tenancy is planned as a later stage of the project.

The intended domain model is currently being explored, but the general idea is:

```text id="q6q4l5"
Company
   │
   ├── Users
   │
   └── Vehicles
          ├── Telemetry
          ├── Trips
          └── Alerts
```

A company would own its vehicles, while users would belong to one or more companies depending on the final authorization model.

The exact user/company relationship has **not been finalized yet**.

### Important

Multi-tenancy is **not implemented yet**.

Vehicles are currently not isolated by company/tenant, and authentication/authorization is not implemented.

This is intentionally deferred until the basic fleet functionality is working.

---

# Authentication

Authentication is also planned for a later stage.

The current `users` table represents part of the future domain model but does **not** mean that authentication is already implemented.

The planned authentication layer will eventually be responsible for:

* User login
* Identity
* Sessions/tokens
* Authorization
* Company membership
* Tenant access

---

# Local Development

## Requirements

* Node.js
* npm

## Install dependencies

```bash id="8cg7on"
npm install
```

## Start development environment

```bash id="q7gx2y"
npm run dev
```

## Start API

```bash id="1c6q7a"
npm run dev:api
```

## Start frontend

```bash id="1ol4re"
npm run dev:web
```

## Seed development database

```bash id="8hl4gd"
npm run db:seed
```

Large dataset (tens of thousands of vehicles, for list/SSE performance):

```bash
npm run db:seed:large
```

API tests:

```bash
npm test
```

List-query bench (against a running API is not required; see `apps/api/scripts/bench.ts`):

```bash
npm run bench
```

Useful environment variables for the API (validated on startup):

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `PORT` | `3000` | |
| `DATABASE_PATH` | `apps/api/data/fleetlive.db` | Use `:memory:` in tests |
| `CORS_ORIGIN` | `*` | |
| `TELEMETRY_TICK_MS` | `400` | `0` disables the simulator |
| `TELEMETRY_BATCH_SIZE` | `32` | Cap per tick on the union of connection focus ids |
| `TELEMETRY_KEEP_PER_VEHICLE` | `100` | Rolling window of raw points per vehicle (live buffer only) |
| `LOG_LEVEL` | `info` | |
| `NODE_ENV` | `development` | Rate limiting is production-only |

---

# Example API Request

Create a vehicle:

```http id="v9ojyv"
POST /api/vehicles
Content-Type: application/json
```

```json id="9xqz1p"
{
  "license_plate": "K-XY 123",
  "driver_name": "Max Mustermann",
  "fuel_level": 85,
  "status": "DRIVING"
}
```

The API validates the request and persists the vehicle in SQLite.

---

# API Design

The backend follows a simple layered structure:

```text id="g7p7h1"
Routes
  │
  ▼
Controllers
  │
  ▼
Models
  │
  ▼
SQLite
```

### Routes

Responsible for defining HTTP endpoints.

### Controllers

Responsible for request handling, validation and HTTP responses.

### Models

Responsible for database operations.

This separation is intentionally lightweight and is intended to keep the API easy to extend as the project grows.

---

# Database Seeding

The development seed script creates example fleet data for local development.

This includes example:

* Users
* Vehicles
* Telemetry
* Alerts

`npm run db:seed:large` replaces the vehicle set with a much larger sample (unique plates and unique driver names — one driver per vehicle) so pagination, search and the live stream can be exercised under load.

---

# Current Limitations

This project is **not production-ready**.

The following areas are intentionally incomplete:

* Authentication
* Authorization
* Multi-tenancy
* Frontend unit tests
* Production deployment
* CI/CD
* Production database
* Observability
* Production security hardening

These are planned development areas rather than features that are currently implemented.

---

# Roadmap

## Phase 1 — Vehicles

* [x] Database schema
* [x] Vehicle model
* [x] Vehicle CRUD API
* [x] Input validation
* [x] Development seed data

## Phase 2 — Frontend

* [x] Vehicle list (search, filters, sorting, pagination)
* [x] Vehicle details page
* [x] Create/edit/delete vehicle UI
* [x] API integration (server-driven list, no mock data)

## Phase 3 — Map and live position

Live telemetry (SSE, per-connection focus, list/detail patches) and the telemetry history API are already in place. This phase is the map on top of that last known point — not a separate telemetry milestone.

* [x] Telemetry history API (`GET /api/vehicles/:id/telemetry`, rolling window)
* [x] Map on the vehicle detail page (Leaflet)
* [x] Marker at the last telemetry position
* [x] Marker moves with SSE updates
* [x] Compact position/speed on or next to the map (full stammdaten stay in the form)
* [x] Trail from the trip path (encoded polyline, length-independent)
* [x] Route-based simulation with city/highway speed limits
* [x] Fleet map (own route `/fleet` over last positions in the viewport; not the list page)

## Later — optional

Not on the main path (companies, auth, tenants). Capture here so it is not forgotten.

* [ ] Speed-limit alerts (“too fast” / similar). Requires map-derived limits on the route; do not treat the sim’s 50/120 profile as legal limits. Belongs with alerts, not as extra vertices on the trip polyline.

## Phase 4 — Companies & Users

* [ ] Company model
* [ ] User/company relationship
* [ ] Authentication
* [ ] Authorization
* [ ] `company_id` on vehicles and trips, index `(company_id, started_at DESC)`
* [ ] Per-tenant retention for trips and raw telemetry (movement data is legally sensitive)

## Phase 5 — Multi-Tenancy

* [ ] Tenant-aware data model
* [ ] Tenant-aware API
* [ ] Data isolation
* [ ] Authorization checks

---

# Project Status

**Work in progress.**

`fleet-live` is a personal full-stack development project.

The project is deliberately being built in small steps, starting with the vehicle API and gradually adding the frontend, visualization, telemetry and eventually authentication and multi-tenancy.

The current implementation should therefore be viewed as an evolving engineering project rather than a finished product.

---

## Why this project?

The goal is to build something that is closer to a real-world application than a small tutorial project.

Fleet management provides a useful domain for exploring:

* REST APIs
* relational data
* TypeScript
* frontend/backend separation
* geospatial visualization
* real-time updates
* data simulation
* authentication
* authorization
* multi-tenant architecture
