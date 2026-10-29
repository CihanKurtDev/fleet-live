import {
    SPEED_CRITICAL_OVER_LIMIT_KMH,
    SPEEDING_HYSTERESIS_MS,
    SPEEDING_OPEN_AFTER_MS,
    isOverSpeedLimit,
    type VehicleStatus,
} from "@fleet-live/shared";

export type SpeedingTracker = {
    phase: "candidate" | "open";
    startedAtMs: number;
    /** Speed at the worst place of the run: the most km/h over its limit. */
    maxSpeed: number;
    alertId?: number;
    belowSinceMs?: number;
    writtenDurationS?: number;
    writtenMaxSpeed?: number;
    writtenLimitKmh?: number;
    /** The limit at that place: a warning reports that pair. */
    limitAtWorst?: number;
    /** Metres into the running trip where the vehicle first went over. */
    fromM?: number;
};

export type SpeedingAction = "none" | "open" | "update" | "end";

export type SpeedingStep = {
    action: SpeedingAction;
    state: SpeedingTracker | undefined;
};

export function speedingSeverity(
    maxSpeed: number,
    limitKmh: number,
): "MEDIUM" | "HIGH" {
    return maxSpeed >= limitKmh + SPEED_CRITICAL_OVER_LIMIT_KMH
        ? "HIGH"
        : "MEDIUM";
}

export function speedingDurationS(
    startedAtMs: number,
    nowMs: number,
): number {
    return Math.max(0, Math.round((nowMs - startedAtMs) / 1000));
}

/** How far a place was over its limit, in km/h; the fine catalogue counts the same. */
export function overLimitKmh(
    speed: number,
    limitKmh: number | null | undefined,
): number {
    return limitKmh === null || limitKmh === undefined
        ? Number.NEGATIVE_INFINITY
        : speed - limitKmh;
}

/** The worst place so far: 70 at 50 beats 121 at 120. */
function atWorst(
    state: SpeedingTracker,
    speed: number,
    limitKmh: number | null | undefined,
): Pick<SpeedingTracker, "maxSpeed" | "limitAtWorst"> {
    return overLimitKmh(speed, limitKmh) >
        overLimitKmh(state.maxSpeed, state.limitAtWorst)
        ? { maxSpeed: speed, limitAtWorst: limitKmh ?? undefined }
        : { maxSpeed: state.maxSpeed, limitAtWorst: state.limitAtWorst };
}

export function stepSpeeding(
    state: SpeedingTracker | undefined,
    input: {
        speed: number | null;
        status: VehicleStatus;
        nowMs: number;
        limit_kmh: number | null | undefined;
    },
): SpeedingStep {
    const exceeding = isOverSpeedLimit(
        input.speed,
        input.status,
        input.limit_kmh,
    );

    if (!state) {
        if (!exceeding || input.speed === null) {
            return { action: "none", state: undefined };
        }

        return {
            action: "none",
            state: {
                phase: "candidate",
                startedAtMs: input.nowMs,
                maxSpeed: input.speed,
                limitAtWorst: input.limit_kmh ?? undefined,
            },
        };
    }

    if (state.phase === "candidate") {
        if (!exceeding || input.speed === null) {
            return { action: "none", state: undefined };
        }

        const next: SpeedingTracker = {
            ...state,
            ...atWorst(state, input.speed, input.limit_kmh),
        };

        if (input.nowMs - state.startedAtMs >= SPEEDING_OPEN_AFTER_MS) {
            return { action: "open", state: { ...next, phase: "open" } };
        }

        return { action: "none", state: next };
    }

    if (input.status !== "DRIVING") {
        return { action: "end", state: undefined };
    }

    if (exceeding && input.speed !== null) {
        const worst = atWorst(state, input.speed, input.limit_kmh);
        const durationS = speedingDurationS(state.startedAtMs, input.nowMs);
        const limitKmh =
            worst.limitAtWorst ?? input.limit_kmh ?? state.writtenLimitKmh;
        const unchanged =
            worst.maxSpeed === state.writtenMaxSpeed &&
            durationS === state.writtenDurationS &&
            limitKmh === state.writtenLimitKmh;
        const next: SpeedingTracker = {
            ...state,
            ...worst,
            belowSinceMs: undefined,
        };

        return {
            action: unchanged ? "none" : "update",
            state: next,
        };
    }

    const belowSinceMs = state.belowSinceMs ?? input.nowMs;

    if (input.nowMs - belowSinceMs >= SPEEDING_HYSTERESIS_MS) {
        return { action: "end", state: undefined };
    }

    return {
        action: "none",
        state: { ...state, belowSinceMs },
    };
}
