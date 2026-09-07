import type { InputHTMLAttributes, Ref } from "react";
import styles from "./Input.module.scss";

type InputSize = "sm" | "md" | "lg";

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
    size?: InputSize;
    fullWidth?: boolean;
    ref?: Ref<HTMLInputElement>;
}

export function Input({
    className,
    size = "md",
    fullWidth = false,
    type = "text",
    ...props
}: InputProps) {
    const classes = [
        styles.input,
        styles[size],
        fullWidth && styles.fullWidth,
        className,
    ]
        .filter(Boolean)
        .join(" ");

    return <input type={type} className={classes} {...props} />;
}
