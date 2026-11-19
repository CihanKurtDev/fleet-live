import { formatCount } from "../../utils/formatCount";

/** The status line after a talk was entered. */
export const talkDoneText = (resolved: number) =>
    resolved === 1
        ? "Gespräch eingetragen, 1 Tempo-Warnung erledigt."
        : `Gespräch eingetragen, ${formatCount(resolved)} Tempo-Warnungen erledigt.`;
