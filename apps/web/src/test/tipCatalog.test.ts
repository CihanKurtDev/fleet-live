import { describe, expect, it } from "vitest";

import { tipsForRole, type TipPageId } from "../components/help/tipCatalog";
import { helpForPath } from "../components/help/helpContent";

const sources = import.meta.glob("../**/*.tsx", {
    query: "?raw",
    import: "default",
    eager: true,
}) as Record<string, string>;
const allSource = Object.entries(sources)
    .filter(([path]) => !path.includes("/test/"))
    .map(([, text]) => text)
    .join("\n");

const PAGES: TipPageId[] = ["briefing", "fristen", "vehicles", "alerts", "drivers", "fleet"];

describe("page tips", () => {
    it.each(PAGES)("%s: every tip points at an element that carries its data-tip", (page) => {
        const tips = tipsForRole(page, "dispatcher");

        expect(tips.length).toBeGreaterThan(0);

        for (const tip of tips) {
            const anchored =
                allSource.includes(`data-tip="${tip.target}"`) ||
                allSource.includes(`tip="${tip.target}"`);

            expect(anchored, `${page}: ${tip.target}`).toBe(true);
        }
    });

    it.each(PAGES)("%s: a page has 1 to 4 tips", (page) => {
        expect(tipsForRole(page, "dispatcher").length).toBeLessThanOrEqual(4);
    });

    it("keeps dispatcher-only tips from viewers", () => {
        expect(tipsForRole("vehicles", "viewer").map((tip) => tip.target)).toEqual([
            "list-tiles",
            "list-search",
        ]);
        expect(tipsForRole("alerts", "viewer").map((tip) => tip.target)).toEqual(["list-tiles"]);
    });

    it("lets the help drawer bring each page's tips back", () => {
        for (const [path, page] of [
            ["/", "briefing"],
            ["/fristen", "fristen"],
            ["/vehicles", "vehicles"],
            ["/alerts", "alerts"],
            ["/drivers", "drivers"],
            ["/fleet", "fleet"],
        ] as const) {
            expect(helpForPath(path)?.tips, path).toBe(page);
        }
    });
});
