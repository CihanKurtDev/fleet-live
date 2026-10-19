import type { ReactNode } from "react";
import { fieldErrorId } from "./fieldAria";

/** The error text of a field; nothing while there is none. */
export const FieldError = ({
    fieldId,
    className,
    children,
}: {
    fieldId: string;
    className?: string;
    children: ReactNode;
}) =>
    children ? (
        <p id={fieldErrorId(fieldId)} className={className} role="alert">
            {children}
        </p>
    ) : null;
