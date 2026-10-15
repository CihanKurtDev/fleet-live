import { useEffect } from "react";

import { DueBoard } from "../components/due/DueBoard";
import { PageTips } from "../components/help/PageTips";
import { useAuth } from "../hooks/useAuth";
import { markDueVisited } from "../hooks/useFirstSteps";

export const DuePage = () => {
    const { user } = useAuth();

    // "Fristen-Vorlauf prüfen" on the Schicht checklist has no server signal.
    useEffect(() => {
        if (user) {
            markDueVisited(user);
        }
    }, [user]);

    return (
        <>
            <DueBoard />
            <PageTips page="fristen" />
        </>
    );
};
