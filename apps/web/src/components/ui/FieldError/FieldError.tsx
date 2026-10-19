import type { ReactNode } from "react";
import { fieldErrorId } from "./fieldAria";

/**
 * The error text of a field; nothing while there is none. It is announced as
 * an alert, unless `announce` is false (the page already shows a banner).
 */
export const FieldError = ({
    fieldId,
    className,
    announce = true,
    children,
}: {
    fieldId: string;
    className?: string;
    announce?: boolean;
    children: ReactNode;
}) =>
    children ? (
        <p
            id={fieldErrorId(fieldId)}
            className={className}
            role={announce ? "alert" : undefined}
        >
            {children}
        </p>
    ) : null;
