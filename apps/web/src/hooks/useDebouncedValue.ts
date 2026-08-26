import { useEffect, useState } from "react";

/**
 * Verzögert die Weitergabe eines sich schnell ändernden Wertes.
 *
 * Wird für das Suchfeld verwendet, damit nicht bei jedem Tastendruck
 * die komplette Zeilen-Pipeline neu durchlaufen wird.
 */
export const useDebouncedValue = <ValueType,>(
    value: ValueType,
    delay = 250,
): ValueType => {
    const [debouncedValue, setDebouncedValue] =
        useState(value);

    useEffect(() => {
        const timeout = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);

        return () => clearTimeout(timeout);
    }, [value, delay]);

    return debouncedValue;
};
