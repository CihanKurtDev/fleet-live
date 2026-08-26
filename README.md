# fleet-live 🚚

A full-stack fleet management application built with **TypeScript, Node.js, Express, React and SQLite**.

The project is being developed incrementally, starting with the backend and domain model, followed by the frontend and eventually vehicle visualization, multi-tenancy and authentication.

> **Status: Work in progress**

This is a personal development project focused on learning and applying full-stack software engineering concepts through a realistic application rather than a tutorial-sized example.

---

## Overview

`fleet-live` is intended to become a fleet management application for monitoring vehicles, their locations, telemetry and alerts.

The application is being developed in several stages.

The **vehicle REST API**, **server-driven vehicle list** and **live telemetry stream** are connected to the React UI. The current stage focuses on map visualization and more realistic movement.

Future iterations will add:

* Vehicle visualization on a map
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
* SSE telemetry stream with client focus
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
* API integration tests (`node:test` + SuperTest)

### Currently being developed

* Map visualization
* More realistic movement (speed limits, routes)

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
* Vehicle domain types
* Vehicle input validation
* Vehicle list query contract (Zod)

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

| Method   | Endpoint              | Description                                      |
| -------- | --------------------- | ------------------------------------------------ |
| `GET`    | `/api/vehicles`       | Paginated vehicle list (`search`, `filter`, `sort`, `dir`, `page`, `limit`) |
| `GET`    | `/api/vehicles/:id`   | Get a vehicle                                    |
| `POST`   | `/api/vehicles`       | Create a vehicle                                 |
| `PUT`    | `/api/vehicles/:id`   | Replace a vehicle                                |
| `PATCH`  | `/api/vehicles/:id`   | Update a vehicle                                 |
| `DELETE` | `/api/vehicles/:id`   | Delete a vehicle                                 |
| `GET`    | `/api/stream`         | SSE: telemetry patches and `vehicles-changed`    |
| `POST`   | `/api/stream/focus`   | Tell the simulator which vehicle ids to tick     |
| `GET`    | `/api/health`         | Check API health                                 |

`GET /api/vehicles` returns `{ data, meta }`. `meta` includes `total`, `pageCount` and facet `counts` for the filter chips.

Query parameters are defined once in `@fleet-live/shared` (`vehicleListQuerySchema`). Invalid sort keys or limits are rejected with `400`. Default page size is `10`; allowed limits are `10`, `25`, `50` and `100`.

The API performs request validation and returns appropriate HTTP status codes for invalid requests, missing resources and conflicts.

Validation errors are returned with the offending fields so that a client can display them next to the corresponding input:

```json id="4k2m9v"
{
  "error": "Tankstand muss zwischen 0 und 100 liegen.",
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

Vehicle responses additionally contain:

* Latitude, longitude, speed and timestamp of the last telemetry record
* The number of currently active alerts

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
| `/vehicles/:id` | Vehicle details, editing and removal |

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

The forms validate their input with the same validation function the API uses, which comes from the shared package.

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

A ticker writes new points only for vehicles with status `DRIVING`. The frontend posts the ids of the visible list page (plus neighbours) and the open detail vehicle to `POST /api/stream/focus`. Speed currently random-walks around the last value instead of jumping.

A dedicated telemetry history API and map-based movement are still open.

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

This will allow vehicles to appear on a map and move over time without requiring real GPS hardware.

---

# Alerts

The database also contains an alert model associated with vehicles.

Alerts are intended to represent events such as abnormal vehicle behaviour or other conditions that should be surfaced to users.

The number of unresolved alerts per vehicle is already exposed through the vehicle API and used in the frontend to highlight and filter affected vehicles.

The alert system will be expanded as the vehicle and telemetry functionality matures.

---

# Database

SQLite is currently used as the database.

The current schema contains:

```text id="8d0q3g"
users
vehicles
telemetry
alerts
```

Vehicles are related to telemetry and alerts through foreign keys.

The database also contains indexes for frequently accessed telemetry data.

A development seed script is provided to create example data.

---

# Development Approach

The project is intentionally being developed incrementally.

Instead of implementing authentication, companies, multi-tenancy and map visualization immediately, the focus is on getting the underlying vehicle functionality correct first.

The planned development path is:

```text id="qf5k7h"
1. Vehicle API
       ↓
2. Vehicle frontend
       ↓
3. API integration + live telemetry
       ↓
4. Map visualization
       ↓
5. Historical telemetry
       ↓
6. Companies
       ↓
7. Users
       ↓
8. Authentication
       ↓
9. Authorization & multi-tenancy
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
| `TELEMETRY_BATCH_SIZE` | `32` | Used when no client focus is set |
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

`npm run db:seed:large` replaces the vehicle set with a much larger sample (unique plates) so pagination, search and the live stream can be exercised under load.

---

# Current Limitations

This project is **not production-ready**.

The following areas are intentionally incomplete:

* Map integration
* Historical telemetry API
* Realistic movement / speed limits
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

## Phase 3 — Map

* [ ] Map integration
* [ ] Display vehicle locations
* [ ] Vehicle details on map

## Phase 4 — Telemetry

* [x] Live telemetry over SSE (driving vehicles, focused ids)
* [ ] Telemetry history API
* [ ] Simulated movement on a map
* [x] Live UI updates (list + detail)

## Phase 5 — Companies & Users

* [ ] Company model
* [ ] User/company relationship
* [ ] Authentication
* [ ] Authorization

## Phase 6 — Multi-Tenancy

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
