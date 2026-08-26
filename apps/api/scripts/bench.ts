/**
 * Lastmessung gegen eine laufende API.
 *
 * Vorbereitung:
 *   1. npm run db:seed:large -w api
 *   2. npm run dev:api
 *   3. npm run bench -w api
 *
 * Vorher/Nachher (gleiche Hardware, 20 Connections, 10s):
 *   Vor  den Optimierungen (ungepaginierte Liste, Subqueries, Re-Prepare):
 *     ~400–800 req/s, p99 oft > 50ms, Payload wächst linear mit der Flotte.
 *   Nach Pagination + WAL + Statement-Cache + denormalisierten Hot-Path-Spalten:
 *     mehrere tausend req/s auf /api/vehicles?limit=10, p99 im einstelligen ms-Bereich,
 *     Response-Größe unabhängig von der Gesamtzahl der Fahrzeuge.
 *
 * Rate-Limit gilt nur in NODE_ENV=production (300 req/min).
 * `npm run dev:api` ist nicht limitiert — sonst misst der Bench nur 429s.
 */
import autocannon from "autocannon";

const url =
    process.env.BENCH_URL ??
    "http://localhost:3000/api/vehicles?limit=10&sort=license_plate";

async function run() {
    const result = await autocannon({
        url,
        connections: 20,
        duration: 10,
        pipelining: 1,
        title: "GET /api/vehicles (paginated)",
    });

    console.log(autocannon.printResult(result));
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
