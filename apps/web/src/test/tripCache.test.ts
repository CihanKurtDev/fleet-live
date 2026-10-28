import type { Trip } from "@fleet-live/shared";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getVehicleTripById } from "../api/vehicles";
import { useTripCache } from "../components/vehicles/useTripCache";

vi.mock("../api/vehicles", () => ({ getVehicleTripById: vi.fn() }));

const fetchTrip = vi.mocked(getVehicleTripById);

const trip = (id: number, endedAt: string | null): Trip => ({
    id,
    vehicle_id: 7,
    driver_id: null,
    driver_name: null,
    started_at: "2026-10-27 08:00:00",
    ended_at: endedAt,
    distance_m: 1000,
    point_count: 2,
    max_speed: 50,
    speeding_count: 0,
    offline_count: 0,
    path: "_p~iF~ps|U_ulLnnqC",
    events: [],
});

const respond = (data: Trip) =>
    fetchTrip.mockResolvedValueOnce({ data } as Awaited<
        ReturnType<typeof getVehicleTripById>
    >);

afterEach(() => {
    fetchTrip.mockReset();
});

describe("useTripCache", () => {
    it("loads a hovered closed trip once and serves it afterwards", async () => {
        respond(trip(3, "2026-10-27 09:00:00"));
        const { result } = renderHook(() => useTripCache(7));

        result.current.prefetch(3);
        result.current.prefetch(3);

        await waitFor(() => expect(result.current.get(3)?.id).toBe(3));
        result.current.prefetch(3);

        expect(fetchTrip).toHaveBeenCalledTimes(1);
        expect(fetchTrip).toHaveBeenCalledWith(7, 3);
    });

    it("keeps no running trip: its line still grows", () => {
        const { result } = renderHook(() => useTripCache(7));

        result.current.remember(trip(4, null));

        expect(result.current.get(4)).toBeNull();
    });

    it("forgets everything after a resolve and for another vehicle", () => {
        const { result, rerender } = renderHook(
            ({ vehicleId }) => useTripCache(vehicleId),
            { initialProps: { vehicleId: 7 } },
        );

        result.current.remember(trip(5, "2026-10-27 09:00:00"));
        result.current.clear();
        expect(result.current.get(5)).toBeNull();

        result.current.remember(trip(5, "2026-10-27 09:00:00"));
        rerender({ vehicleId: 8 });
        expect(result.current.get(5)).toBeNull();
    });
});
