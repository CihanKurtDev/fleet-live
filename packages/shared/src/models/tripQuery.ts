import { z } from "zod";
import type { TripListItem } from "./trip";
import { emptyToUndefined } from "./queryPreprocess";

export const TRIP_PAGE_LIMITS = [10, 25, 50] as const;

export type TripPageLimit = (typeof TRIP_PAGE_LIMITS)[number];

export type TripListMeta = {
    page: number;
    limit: number;
    total: number;
    pageCount: number;
};

export type TripListResponse = {
    data: TripListItem[];
    meta: TripListMeta;
};

export const tripListQuerySchema = z.object({
    page: z.preprocess(
        emptyToUndefined,
        z.coerce
            .number({ error: "Seite muss eine Zahl sein." })
            .int("Seite muss eine ganze Zahl sein.")
            .min(1, "Seite muss mindestens 1 sein.")
            .default(1),
    ),
    limit: z.preprocess(
        emptyToUndefined,
        z.coerce
            .number({ error: "Limit muss eine Zahl sein." })
            .int("Limit muss eine ganze Zahl sein.")
            .refine(
                (value) =>
                    (TRIP_PAGE_LIMITS as readonly number[]).includes(value),
                `Limit muss ${TRIP_PAGE_LIMITS.join(", ")} sein.`,
            )
            .default(10),
    ),
});

export type TripListQuery = z.infer<typeof tripListQuerySchema>;

export function parseTripListQuery(input: unknown): TripListQuery {
    return tripListQuerySchema.parse(input);
}
