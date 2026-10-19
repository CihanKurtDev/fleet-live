import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import {
    fleetPositionsQuerySchema,
    isVehicleFilterId,
    serializeFleetPositionsQuery,
    type FleetPositionsQuery,
    type GeoBBox,
    type VehicleFilterId,
} from "@fleet-live/shared";

import { useDebouncedValue } from "./useDebouncedValue";
const sameBBox = (left: GeoBBox | null, right: GeoBBox) =>
    left !== null &&
    left.west === right.west &&
    left.south === right.south &&
    left.east === right.east &&
    left.north === right.north;

const readBBox = (raw: string | null): GeoBBox | null => {
    if (!raw) {
        return null;
    }

    const parsed = fleetPositionsQuerySchema.safeParse({ bbox: raw });

    return parsed.success && parsed.data.bbox ? parsed.data.bbox : null;
};

export const useFleetPageQuery = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const filterParam = searchParams.get("filter");
    const filter = isVehicleFilterId(filterParam) ? filterParam : undefined;
    const search = searchParams.get("search") ?? "";
    const driversKey = searchParams.getAll("drivers").join("\0");
    const drivers = useMemo(() => {
        const parsed = fleetPositionsQuerySchema.safeParse({
            drivers: driversKey.length > 0 ? driversKey.split("\0") : [],
        });

        return parsed.success ? (parsed.data.drivers ?? []) : [];
    }, [driversKey]);
    const driverSearch = (searchParams.get("driver_search") ?? "").slice(0, 100);
    const bboxRaw = searchParams.get("bbox");
    const bbox = useMemo(() => readBBox(bboxRaw), [bboxRaw]);
    const depotRaw = searchParams.get("depot");
    const depotId =
        depotRaw !== null && /^[1-9]\d*$/.test(depotRaw)
            ? Number(depotRaw)
            : undefined;
    // The selected vehicle lives in the URL too, so Back from its detail
    // page returns to it.
    const vehicleRaw = searchParams.get("vehicle");
    const vehicleId =
        vehicleRaw !== null && /^[1-9]\d*$/.test(vehicleRaw)
            ? Number(vehicleRaw)
            : null;
    const [searchDraft, setSearchDraft] = useState(search);
    const [prevSearch, setPrevSearch] = useState(search);
    if (search !== prevSearch) {
        setPrevSearch(search);
        setSearchDraft(search);
    }
    const debouncedSearch = useDebouncedValue(searchDraft);
    const writeQuery = useCallback(
        (
            next: FleetPositionsQuery,
            nextDepot?: number | null,
            nextVehicle?: number | null,
        ) => {
            const params = serializeFleetPositionsQuery(next);
            const depot = nextDepot === undefined ? depotId : nextDepot;
            const vehicle = nextVehicle === undefined ? vehicleId : nextVehicle;

            if (depot) {
                params.set("depot", String(depot));
            }

            if (vehicle) {
                params.set("vehicle", String(vehicle));
            }

            setSearchParams(params, { replace: true });
        },
        [depotId, setSearchParams, vehicleId],
    );

    useEffect(() => {
        if (debouncedSearch === search) {
            return;
        }

        writeQuery({
            bbox: bbox ?? undefined,
            filter,
            search: debouncedSearch || undefined,
            drivers: drivers.length > 0 ? drivers : undefined,
            driver_search: driverSearch || undefined,
        });
    }, [bbox, debouncedSearch, driverSearch, drivers, filter, search, writeQuery]);

    const setFilter = useCallback(
        (next: VehicleFilterId | undefined) => {
            writeQuery({
                bbox: bbox ?? undefined,
                filter: next,
                search: search || undefined,
                drivers: drivers.length > 0 ? drivers : undefined,
                driver_search: driverSearch || undefined,
            });
        },
        [bbox, driverSearch, drivers, search, writeQuery],
    );

    const setDrivers = useCallback(
        (names: string[]) => {
            writeQuery({
                bbox: bbox ?? undefined,
                filter,
                search: search || undefined,
                drivers: names.length > 0 ? names : undefined,
            });
        },
        [bbox, filter, search, writeQuery],
    );

    /** A text instead of names: every driver or plate that contains it. */
    const setDriverSearch = useCallback(
        (text: string) => {
            writeQuery({
                bbox: bbox ?? undefined,
                filter,
                search: search || undefined,
                driver_search: text.trim() || undefined,
            });
        },
        [bbox, filter, search, writeQuery],
    );

    const setBBox = useCallback(
        (next: GeoBBox) => {
            if (sameBBox(bbox, next)) {
                return;
            }

            writeQuery({
                bbox: next,
                filter,
                search: search || undefined,
                drivers: drivers.length > 0 ? drivers : undefined,
                driver_search: driverSearch || undefined,
            });
        },
        [bbox, driverSearch, drivers, filter, search, writeQuery],
    );

    const setDepot = useCallback(
        (id: number | null) => {
            writeQuery(
                {
                    bbox: bbox ?? undefined,
                    filter,
                    search: search || undefined,
                    drivers: drivers.length > 0 ? drivers : undefined,
                    driver_search: driverSearch || undefined,
                },
                id,
            );
        },
        [bbox, driverSearch, drivers, filter, search, writeQuery],
    );

    const setVehicle = useCallback(
        (id: number | null) => {
            writeQuery(
                {
                    bbox: bbox ?? undefined,
                    filter,
                    search: search || undefined,
                    drivers: drivers.length > 0 ? drivers : undefined,
                    driver_search: driverSearch || undefined,
                },
                undefined,
                id,
            );
        },
        [bbox, driverSearch, drivers, filter, search, writeQuery],
    );

    return {
        bbox,
        filter,
        search,
        drivers,
        driverSearch,
        setDriverSearch,
        depotId,
        vehicleId,
        setVehicle,
        searchDraft,
        setSearchDraft,
        setFilter,
        setDrivers,
        setBBox,
        setDepot,
        searchParams,
    };
};
