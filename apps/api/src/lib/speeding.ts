import {
    SPEED_HIGH_CRITICAL_KMH,
    SPEED_HIGH_WARNING_KMH,
    SPEEDING_HYSTERESIS_MS,
    SPEEDING_OPEN_AFTER_MS,
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
};

export type SpeedingAction = "none" | "open" | "update" | "end";

export type SpeedingStep = {
    action: SpeedingAction;
    state: SpeedingTracker | undefined;
};

function isExceeding(
    speed: number | null,
    status: VehicleStatus,
): speed is number {
    return (
        status === "DRIVING" &&
        speed !== null &&
        speed >= SPEED_HIGH_WARNING_KMH
    );
}

export function speedingSeverity(
    maxSpeed: number,
): "MEDIUM" | "HIGH" {
    return maxSpeed >= SPEED_HIGH_CRITICAL_KMH ? "HIGH" : "MEDIUM";
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
    },
): SpeedingStep {
    const exceeding = isExceeding(input.speed, input.status);

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
        const unchanged =
            maxSpeed === state.writtenMaxSpeed &&
            durationS === state.writtenDurationS;
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
