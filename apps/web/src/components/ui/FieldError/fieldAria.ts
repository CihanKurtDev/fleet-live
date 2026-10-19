export const fieldErrorId = (fieldId: string) => `${fieldId}-error`;

/**
 * `aria-invalid` and `aria-describedby` of a field: the ids of its hints (in
 * the order given), then its error text, so a screen reader reads the error
 * with the field. Spread it on the input or select.
 */
export const fieldAria = (
    fieldId: string,
    error: string | null | undefined,
    ...hintIds: Array<string | undefined>
) => ({
    "aria-invalid": Boolean(error),
    "aria-describedby":
        [...hintIds, error ? fieldErrorId(fieldId) : undefined]
            .filter(Boolean)
            .join(" ") || undefined,
});
