import { stmt } from "../db/statements";

export type SqlParam = string | number | null;

type RowWithTotal = { total?: number };

/**
 * Eine Seite plus Gesamtzahl. Die List-SQL muss `COUNT(*) OVER () AS total`
 * mitliefern. Ist die Seite leer, zählt `countSql` nach — sonst wäre
 * `total` 0, obwohl Treffer auf anderen Seiten liegen.
 */
export function pagedQuery<TRow extends RowWithTotal, T>(options: {
    listSql: string;
    listParams: SqlParam[];
    countSql: string;
    countParams: SqlParam[];
    page: number;
    limit: number;
    map: (row: TRow) => T;
}): {
    data: T[];
    meta: { page: number; limit: number; total: number; pageCount: number };
} {
    const rows = stmt(options.listSql).all(...options.listParams) as TRow[];
    let total = Number(rows[0]?.total ?? 0);

    if (rows.length === 0) {
        total = Number(
            (stmt(options.countSql).get(...options.countParams) as { total: number })
                .total,
        );
    }

    return {
        data: rows.map(options.map),
        meta: {
            page: options.page,
            limit: options.limit,
            total,
            pageCount: Math.max(1, Math.ceil(total / options.limit)),
        },
    };
}
