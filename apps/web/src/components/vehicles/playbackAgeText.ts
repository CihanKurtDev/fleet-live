/**
 * „Stand vor 6 s“: how old the position on the map is. The map plays the
 * reports a few seconds in the past so the vehicle moves evenly; this says
 * so. „ca.“ when the time does not come from the device.
 */
export const formatPlaybackAge = (ageMs: number, estimated: boolean) => {
    const seconds = Math.max(1, Math.round(ageMs / 1000));
    const about = estimated ? "ca. " : "";

    return seconds < 60
        ? `Stand vor ${about}${seconds} s`
        : `Stand vor ${about}${Math.round(seconds / 60)} min`;
};
