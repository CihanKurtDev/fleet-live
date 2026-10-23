import { useEffect, useRef } from "react";

import { useLatestRef } from "../../hooks/useLatestRef";
import { formatPlaybackAge } from "./playbackAgeText";
import type { ShownPosition } from "./vehiclePlayback";
import styles from "./leafletMap.module.scss";

const REFRESH_MS = 500;

type PlaybackAgeProps = {
    /** The shown position of the vehicle the label is about, or nothing to hide it. */
    read: (now: number) => ShownPosition | undefined;
};

/**
 * The age label on a map. It reads the playback twice a second and writes
 * the text itself, so the map's component does not render for it.
 */
export const PlaybackAge = ({ read }: PlaybackAgeProps) => {
    const ref = useRef<HTMLParagraphElement>(null);
    const readRef = useLatestRef(read);

    useEffect(() => {
        const update = () => {
            const element = ref.current;

            if (!element) {
                return;
            }

            const shown = readRef.current(performance.now());
            const text =
                shown && shown.age !== null
                    ? formatPlaybackAge(shown.age, shown.estimated)
                    : "";

            if (element.textContent !== text) {
                element.textContent = text;
            }

            element.hidden = text === "";
        };

        update();
        const timer = window.setInterval(update, REFRESH_MS);

        return () => window.clearInterval(timer);
    }, [readRef]);

    return (
        <p
            ref={ref}
            className={styles.playbackAge}
            title="Die Karte zeigt die Fahrt ein paar Sekunden versetzt, damit sie gleichmäßig läuft."
            hidden
        />
    );
};
