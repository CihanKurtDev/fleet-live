import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { usePageTitle } from "../hooks/usePageTitle";

const Page = ({ title }: { title: string | null }) => {
    usePageTitle(title);
    return null;
};

describe("usePageTitle", () => {
    it("names the tab after the page and follows a changed title", () => {
        const view = render(<Page title="Fahrzeuge" />);
        expect(document.title).toBe("Fahrzeuge · fleet-live");

        view.rerender(<Page title="K-AB 1" />);
        expect(document.title).toBe("K-AB 1 · fleet-live");
    });

    it("shows just the app name while the page has no title yet", () => {
        render(<Page title={null} />);

        expect(document.title).toBe("fleet-live");
    });
});
