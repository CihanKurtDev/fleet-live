# fleet-live 🚚

A full-stack fleet management application built with **TypeScript, Node.js, Express, React and SQLite**.

The project is being developed incrementally, starting with the backend and domain model, followed by the frontend and eventually vehicle visualization, multi-tenancy and authentication.

> **Status: Work in progress**

This is a personal development project focused on learning and applying full-stack software engineering concepts through a realistic application rather than a tutorial-sized example.

---

## Overview

`fleet-live` is intended to become a fleet management application for monitoring vehicles, their locations, telemetry and alerts.

The application is being developed in several stages.

The **vehicle REST API** and the underlying database model are in place, and the **vehicle management UI** is built on top of mock data. The current stage focuses on connecting the frontend to the API.

Future iterations will add:

* Vehicle visualization on a map
* Simulated vehicle movement and telemetry
* Companies and users
* Authentication and authorization
* Multi-tenant data isolation

The project is intentionally being developed step by step rather than implementing all of these concerns at once.

---

## Current Status

The backend provides the vehicle API, and the frontend implements the vehicle management UI on top of mock data.

### Implemented

* TypeScript backend
* Express API
* SQLite database
* Vehicle model
* Vehicle CRUD API
* Input validation
* HTTP status handling
* Database relationships
* Telemetry data model
* Alert data model
* Development seed data
* Health endpoint
* Separate frontend and API applications
* Shared domain package for types and validation
* Vehicle input validation shared between API and frontend
* Field-level validation errors in API responses
* Last telemetry and active alert count in vehicle responses
* React frontend with client-side routing
* Generic, reusable table component
* Vehicle list with search, filters, sorting and pagination
* Vehicle detail page
* Create, edit and delete vehicle UI

### Currently being developed

* Frontend API integration (replacing the mock data)
* Map visualization
* Telemetry simulation

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
│   │       ├── models/
│   │       ├── routes/
│   │       └── server.ts
│   │
│   └── web/
│       └── src/
│           ├── components/
│           │   ├── ui/
│           │   └── vehicles/
│           ├── context/
│           ├── hooks/
│           ├── mocks/
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
                           HTTP
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

## Development

* npm Workspaces
* tsx
* ESLint
* TypeScript

---

# Vehicle API

The first development milestone is a reliable REST API for vehicle management.

## Endpoints

| Method   | Endpoint            | Description       |
| -------- | ------------------- | ----------------- |
| `GET`    | `/api/vehicles`     | List all vehicles |
| `GET`    | `/api/vehicles/:id` | Get a vehicle     |
| `POST`   | `/api/vehicles`     | Create a vehicle  |
| `PUT`    | `/api/vehicles/:id` | Replace a vehicle |
| `PATCH`  | `/api/vehicles/:id` | Update a vehicle  |
| `DELETE` | `/api/vehicles/:id` | Delete a vehicle  |
| `GET`    | `/api/health`       | Check API health  |

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

> The frontend currently runs on mock data. The API is **not** connected yet.

## Routes

| Route           | Description                          |
| --------------- | ------------------------------------ |
| `/`             | Redirects to the vehicle list        |
| `/vehicles`     | Vehicle list and creation dialog     |
| `/vehicles/:id` | Vehicle details, editing and removal |

## Vehicle list

The vehicle list is built on a generic table component that receives its columns and filters through a configuration and contains no vehicle-specific logic itself.

It supports:

* Search across license plate and driver
* Filters for alerts, low fuel, driving and offline vehicles
* Sorting per column
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

The last telemetry record of a vehicle is already included in the vehicle API responses. A dedicated telemetry endpoint for historical data and simulated vehicle movement are still open.

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
2. Test API manually
       ↓
3. Vehicle frontend
       ↓
4. Map visualization
       ↓
5. Telemetry
       ↓
6. Simulated vehicle movement
       ↓
7. Companies
       ↓
8. Users
       ↓
9. Authentication
       ↓
10. Authorization & multi-tenancy
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

The seed data makes it possible to develop and test the API without manually creating every record.

---

# Current Limitations

This project is **not production-ready**.

The following areas are intentionally incomplete:

* Frontend API integration (the frontend uses mock data)
* Map integration
* Live telemetry
* Telemetry simulation
* Authentication
* Authorization
* Multi-tenancy
* Automated tests
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
* [ ] API integration (frontend currently runs on mock data)

## Phase 3 — Map

* [ ] Map integration
* [ ] Display vehicle locations
* [ ] Vehicle details on map

## Phase 4 — Telemetry

* [ ] Telemetry API
* [ ] Historical telemetry
* [ ] Simulated vehicle movement
* [ ] Live UI updates

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
