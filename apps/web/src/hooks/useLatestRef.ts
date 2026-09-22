import { useEffect, useRef, type MutableRefObject } from "react";

/** Keeps a ref pointing at the latest value without updating during render. */
export const useLatestRef = <T,>(value: T): MutableRefObject<T> => {
    const ref = useRef(value);

    useEffect(() => {
        ref.current = value;
    });

    return ref;
};
