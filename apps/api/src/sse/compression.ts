import zlib from "node:zlib";
import type { Response } from "express";

/**
 * Was der Hub von einem Zuschauer braucht. Ein Express-`Response` erfüllt es
 * ohne Kompression, `CompressedSseWriter` mit.
 */
export type SseWriter = {
    write(chunk: string): boolean;
    readonly writableNeedDrain: boolean;
    once(event: "drain", listener: () => void): unknown;
    end(): unknown;
};

export type SseEncoding = "br" | "gzip" | "identity";

/**
 * Wählt aus `Accept-Encoding`: Brotli, sonst gzip, sonst unkomprimiert.
 * `q=0` lehnt ein Verfahren ausdrücklich ab.
 */
export function pickEncoding(acceptEncoding: string | undefined): SseEncoding {
    const accepted = new Set<string>();

    for (const part of (acceptEncoding ?? "").split(",")) {
        const [name, ...params] = part.trim().toLowerCase().split(";");
        const quality = params
            .map((param) => /^\s*q\s*=\s*([\d.]+)\s*$/.exec(param)?.[1])
            .find((value) => value !== undefined);

        if (name && (quality === undefined || Number(quality) > 0)) {
            accepted.add(name.trim());
        }
    }

    if (accepted.has("br")) {
        return "br";
    }

    return accepted.has("gzip") ? "gzip" : "identity";
}

/**
 * Komprimiert einen Event-Strom, ohne ihn zu verzögern: Nach jedem Ereignis
 * wird der Kompressor durchgespült (Sync-Flush), der Zuschauer kann es sofort
 * entpacken. Das Wörterbuch bleibt über die Ereignisse erhalten, spätere
 * Ticks werden daher noch kleiner. Der allgemeine `compression`-Middleware
 * ist dafür ungeeignet, er sammelt Daten bis zum Ende.
 */
class CompressedSseWriter implements SseWriter {
    private readonly compressor: zlib.BrotliCompress | zlib.Gzip;
    private readonly flushKind: number;

    constructor(
        private readonly res: Response,
        encoding: Exclude<SseEncoding, "identity">,
    ) {
        if (encoding === "br") {
            this.compressor = zlib.createBrotliCompress({
                params: {
                    // Qualität 4: fast so klein wie 6, aber deutlich schneller.
                    [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
                },
            });
            this.flushKind = zlib.constants.BROTLI_OPERATION_FLUSH;
        } else {
            this.compressor = zlib.createGzip({ level: 1 });
            this.flushKind = zlib.constants.Z_SYNC_FLUSH;
        }

        this.compressor.on("error", () => res.destroy());
        this.compressor.pipe(res);
    }

    write(chunk: string): boolean {
        const accepted = this.compressor.write(chunk);

        this.compressor.flush(this.flushKind);
        return accepted && !this.res.writableNeedDrain;
    }

    /** Voll, wenn der Kompressor oder der Socket dahinter nichts mehr annimmt. */
    get writableNeedDrain(): boolean {
        return this.compressor.writableNeedDrain || this.res.writableNeedDrain;
    }

    once(event: "drain", listener: () => void) {
        // Wo es gerade hakt, dort melden: der Kompressor leert sich erst, wenn
        // der Socket wieder annimmt.
        if (this.compressor.writableNeedDrain) {
            this.compressor.once(event, listener);
        } else {
            this.res.once(event, listener);
        }

        return this;
    }

    end() {
        this.compressor.end();
    }
}

/**
 * Der Schreiber für einen Event-Strom: setzt `Content-Encoding` (vor
 * `flushHeaders`) und liefert den Kompressor oder, ohne Kompression, die
 * Antwort selbst.
 */
export function openSseWriter(
    res: Response,
    acceptEncoding: string | undefined,
): SseWriter {
    const encoding = pickEncoding(acceptEncoding);

    res.setHeader("Vary", "Accept-Encoding");

    if (encoding === "identity") {
        return res;
    }

    res.setHeader("Content-Encoding", encoding);
    return new CompressedSseWriter(res, encoding);
}
