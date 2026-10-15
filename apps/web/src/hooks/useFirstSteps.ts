import { useEffect, useState } from "react";
import { parseVehicleListQuery, type AuthUser } from "@fleet-live/shared";

import { listMembers } from "../api/auth";
import { listImportRuns } from "../api/import";
import { listSites } from "../api/sites";
import { listVehicles } from "../api/vehicles";
import { formatCount } from "../utils/formatCount";
import { readFlag, userCompanyKey, writeFlag } from "../utils/localFlags";

export type FirstStepId = "import" | "depot" | "due" | "team" | "totp";

export type FirstStep = {
    id: FirstStepId;
    title: string;
    /** Short line under the title while the step is open. */
    hint: string;
    /** Short line under the title once the step is done. */
    doneHint: string;
    to: string;
    done: boolean;
};

type Signals = {
    vehicles: number | null;
    importRuns: number | null;
    sites: number | null;
    members: number | null;
};

const hiddenKey = (user: AuthUser) => userCompanyKey("first-steps-hidden", user);
const dueVisitedKey = (user: AuthUser) => userCompanyKey("fristen-visited", user);

/** The Fristen page calls this; the checklist has no server signal for it. */
export const markDueVisited = (user: AuthUser) => {
    writeFlag(dueVisitedKey(user));
};

const settledCount = <T>(
    result: PromiseSettledResult<T>,
    count: (value: T) => number,
): number | null =>
    result.status === "fulfilled" ? count(result.value) : null;

const plural = (count: number, one: string, many: string) =>
    count === 1 ? `1 ${one}` : `${formatCount(count)} ${many}`;

/** Builds the steps that have a known state. A step without a signal is left out. */
export function buildFirstSteps(
    user: AuthUser,
    signals: Signals,
    dueVisited: boolean,
): FirstStep[] {
    const steps: FirstStep[] = [];
    const { vehicles, importRuns, sites, members } = signals;

    if (vehicles !== null || importRuns !== null) {
        const hasVehicles = (vehicles ?? 0) > 0;
        const hasRuns = (importRuns ?? 0) > 0;

        steps.push({
            id: "import",
            title: "Bestand importieren",
            hint: "CSV oder Excel",
            doneHint: hasVehicles
                ? plural(vehicles ?? 0, "Fahrzeug", "Fahrzeuge")
                : "Import gelaufen",
            to: "/vehicles/import",
            done: hasVehicles || hasRuns,
        });
    }

    if (sites !== null) {
        steps.push({
            id: "depot",
            title: "Depot anlegen",
            hint: "Kreis auf der Karte",
            doneHint: plural(sites, "Depot", "Depots"),
            to: "/fleet",
            done: sites > 0,
        });
    }

    steps.push({
        id: "due",
        title: "Fristen-Vorlauf prüfen",
        hint: "Wann HU, UVV und Führerschein auftauchen",
        doneHint: "Angesehen",
        to: "/fristen",
        done: dueVisited,
    });

    if (members !== null) {
        steps.push({
            id: "team",
            title: "Team einladen",
            hint: "Dispatcher oder nur lesen",
            doneHint: plural(members, "Mitglied", "Mitglieder"),
            to: "/konto",
            done: members > 1,
        });
    }

    steps.push({
        id: "totp",
        title: "Zwei-Faktor einrichten",
        hint: "Authenticator-App",
        doneHint: "Eingerichtet",
        to: "/konto",
        done: user.totp_enabled,
    });

    return steps;
}

/**
 * First steps for a dispatcher of the active company. Viewers get none: they
 * cannot import, place depots, set the lead or invite.
 */
export const useFirstSteps = (user: AuthUser | null) => {
    const applies =
        user !== null && user.role === "dispatcher" && !user.import_prompt;
    const scope = user ? `${user.id}:${user.company_id}` : "";
    const [loaded, setLoaded] = useState<{
        scope: string;
        signals: Signals;
    } | null>(null);
    const [hiddenScope, setHiddenScope] = useState<string | null>(null);
    const hidden =
        user !== null && (hiddenScope === scope || readFlag(hiddenKey(user)));

    useEffect(() => {
        if (!applies || hidden) {
            return;
        }

        let active = true;

        void Promise.allSettled([
            listVehicles(parseVehicleListQuery({})),
            listImportRuns(),
            listSites(),
            listMembers(),
        ]).then(([vehicles, runs, sites, members]) => {
            if (!active) {
                return;
            }

            setLoaded({
                scope,
                signals: {
                    vehicles: settledCount(vehicles, (value) => value.meta.total),
                    importRuns: settledCount(runs, (value) => value.meta.total),
                    sites: settledCount(sites, (value) => value.data.length),
                    members: settledCount(members, (value) => value.data.length),
                },
            });
        });

        return () => {
            active = false;
        };
    }, [applies, hidden, scope]);

    const hide = () => {
        if (!user) {
            return;
        }

        writeFlag(hiddenKey(user));
        setHiddenScope(scope);
    };

    const steps =
        applies && !hidden && user && loaded?.scope === scope
            ? buildFirstSteps(user, loaded.signals, readFlag(dueVisitedKey(user)))
            : [];

    return { steps, hide };
};
