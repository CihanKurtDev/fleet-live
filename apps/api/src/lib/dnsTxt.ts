import { Resolver } from "node:dns/promises";

/** No record under that name (or no such name): an answer, not a failure. */
const NOT_FOUND = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

export class DnsUnavailableError extends Error {}

type TxtLookup = (name: string) => Promise<string[][]>;

let testLookup: TxtLookup | null = null;

/** The TXT strings at `name`, each record's chunks joined; [] when there is none. */
export async function lookupTxt(name: string): Promise<string[]> {
    try {
        const records = testLookup
            ? await testLookup(name)
            : await new Resolver({ timeout: 5000, tries: 2 }).resolveTxt(name);

        return records.map((chunks) => chunks.join(""));
    } catch (caught: unknown) {
        const code = (caught as { code?: string } | null)?.code;

        if (code && NOT_FOUND.has(code)) {
            return [];
        }

        throw new DnsUnavailableError(String(code ?? caught));
    }
}

export function setTxtLookupForTests(next: TxtLookup | null) {
    testLookup = next;
}
