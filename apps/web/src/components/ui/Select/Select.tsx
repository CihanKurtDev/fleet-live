import type { Ref, SelectHTMLAttributes } from "react";
import styles from "./Select.module.scss";

type SelectSize = "sm" | "md";

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
    size?: SelectSize;
    fullWidth?: boolean;
    ref?: Ref<HTMLSelectElement>;
}

/**
 * The one select of the app: looks and behaves like `Input` (same border,
 * focus, error and disabled states, same sizes). The list that opens stays
 * the browser's own.
 */
export function Select({
    className,
    size = "md",
    fullWidth = false,
    ...props
}: SelectProps) {
    const classes = [
        styles.select,
        styles[size],
        fullWidth && styles.fullWidth,
        className,
    ]
        .filter(Boolean)
        .join(" ");

    return <select className={classes} {...props} />;
}
