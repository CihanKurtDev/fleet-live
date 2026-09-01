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
    maxSpeed: number;
    alertId?: number;
    belowSinceMs?: number;
    writtenDurationS?: number;
    writtenMaxSpeed?: number;
    writtenLimitKmh?: number;
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
        if (!exceeding) {
            return { action: "none", state: undefined };
        }

        return {
            action: "none",
            state: {
                phase: "candidate",
                startedAtMs: input.nowMs,
                maxSpeed: input.speed,
            },
        };
    }

    if (state.phase === "candidate") {
        if (!exceeding) {
            return { action: "none", state: undefined };
        }

        const next: SpeedingTracker = {
            ...state,
            maxSpeed: Math.max(state.maxSpeed, input.speed),
        };

        if (input.nowMs - state.startedAtMs >= SPEEDING_OPEN_AFTER_MS) {
            return { action: "open", state: { ...next, phase: "open" } };
        }

        return { action: "none", state: next };
    }

    if (input.status !== "DRIVING") {
        return { action: "end", state: undefined };
    }

    if (exceeding) {
        const maxSpeed = Math.max(state.maxSpeed, input.speed);
        const durationS = speedingDurationS(state.startedAtMs, input.nowMs);
        const limitKmh = input.limit_kmh ?? state.writtenLimitKmh;
        const unchanged =
            maxSpeed === state.writtenMaxSpeed &&
            durationS === state.writtenDurationS &&
            limitKmh === state.writtenLimitKmh;
        const next: SpeedingTracker = {
            ...state,
            maxSpeed,
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
