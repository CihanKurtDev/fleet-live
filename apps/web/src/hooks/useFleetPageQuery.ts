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
    const bboxRaw = searchParams.get("bbox");
    const bbox = useMemo(() => readBBox(bboxRaw), [bboxRaw]);
    const [searchDraft, setSearchDraft] = useState(search);
    const debouncedSearch = useDebouncedValue(searchDraft);

    useEffect(() => {
        setSearchDraft(search);
    }, [search]);

    const writeQuery = useCallback(
        (next: FleetPositionsQuery) => {
            setSearchParams(serializeFleetPositionsQuery(next), {
                replace: true,
            });
        },
        [setSearchParams],
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
        });
    }, [bbox, debouncedSearch, drivers, filter, search, writeQuery]);

    const setFilter = useCallback(
        (next: VehicleFilterId | undefined) => {
            writeQuery({
                bbox: bbox ?? undefined,
                filter: next,
                search: search || undefined,
                drivers: drivers.length > 0 ? drivers : undefined,
            });
        },
        [bbox, drivers, search, writeQuery],
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
            });
        },
        [bbox, drivers, filter, search, writeQuery],
    );

    return {
        bbox,
        filter,
        search,
        drivers,
        searchDraft,
        setSearchDraft,
        setFilter,
        setDrivers,
        setBBox,
        searchParams,
    };
};
