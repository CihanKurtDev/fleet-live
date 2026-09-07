import type { InputHTMLAttributes } from "react";
import styles from "./Checkbox.module.scss";

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
    className?: string;
}

export function Checkbox({ className, ...props }: CheckboxProps) {
    const classes = [styles.checkbox, className].filter(Boolean).join(" ");

    return <input type="checkbox" className={classes} {...props} />;
}
