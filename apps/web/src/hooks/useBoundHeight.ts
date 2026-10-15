import { useEffect, useRef, useState } from "react";

/**
 * Height of the element; 0 while the layout lets it grow (stacked, where the
 * list does not scroll on its own). Read from the element's own style, so a
 * resize between both layouts is measured with the layout that applies.
 */
export function useBoundHeight<T extends HTMLElement = HTMLDivElement>() {
    const ref = useRef<T>(null);
    const [height, setHeight] = useState(0);

    useEffect(() => {
        const element = ref.current;
        if (!element) {
            return;
        }

        const measure = () => {
            const bound = getComputedStyle(element).overflowY !== "visible";
            setHeight(bound ? element.clientHeight : 0);
        };
        const observer = new ResizeObserver(measure);

        // The list can keep its height across a layout switch; the document
        // size always changes with the window.
        observer.observe(element);
        observer.observe(document.documentElement);
        window.addEventListener("resize", measure);
        measure();

        return () => {
            observer.disconnect();
            window.removeEventListener("resize", measure);
        };
    }, []);

    return { ref, height };
}
