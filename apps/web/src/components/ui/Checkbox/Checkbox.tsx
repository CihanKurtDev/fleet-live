import { useEffect, useRef, type InputHTMLAttributes } from "react";
import styles from "./Checkbox.module.scss";

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
    className?: string;
    /** Teilauswahl. Nur ein DOM-Property, kein HTML-Attribut. */
    indeterminate?: boolean;
}

export function Checkbox({
    className,
    indeterminate = false,
    ...props
}: CheckboxProps) {
    const ref = useRef<HTMLInputElement>(null);
    const classes = [styles.checkbox, className].filter(Boolean).join(" ");

    useEffect(() => {
        if (ref.current) {
            ref.current.indeterminate = indeterminate;
        }
    }, [indeterminate]);

    return <input ref={ref} type="checkbox" className={classes} {...props} />;
}
