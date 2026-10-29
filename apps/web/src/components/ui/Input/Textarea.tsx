import type { Ref, TextareaHTMLAttributes } from "react";
import styles from "./Input.module.scss";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
    ref?: Ref<HTMLTextAreaElement>;
}

/** A multi-line field with the same border, focus and error states as `Input`. */
export function Textarea({ className, rows = 3, ...props }: TextareaProps) {
    const classes = [styles.input, styles.textarea, styles.fullWidth, className]
        .filter(Boolean)
        .join(" ");

    return <textarea rows={rows} className={classes} {...props} />;
}
