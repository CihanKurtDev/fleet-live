import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ThemeToggle } from "../components/ThemeToggle";
import { initTheme } from "../utils/theme";

afterEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
});

describe("Hell/Dunkel-Schalter", () => {
    it("names where it switches to and switches the page", () => {
        initTheme();
        render(<ThemeToggle />);

        // jsdom has no system dark mode: the page starts light.
        expect(document.documentElement.dataset.theme).toBe("light");
        fireEvent.click(screen.getByRole("button", { name: "Dunkel schalten" }));

        expect(document.documentElement.dataset.theme).toBe("dark");
        expect(window.localStorage.getItem("fleet-live:theme")).toBe("dark");
        expect(
            screen.getByRole("button", { name: "Hell schalten" }),
        ).toBeInTheDocument();
    });

    it("follows the system again when the system's scheme is picked", () => {
        window.localStorage.setItem("fleet-live:theme", "dark");
        initTheme();
        render(<ThemeToggle />);

        fireEvent.click(screen.getByRole("button", { name: "Hell schalten" }));

        expect(document.documentElement.dataset.theme).toBe("light");
        expect(window.localStorage.getItem("fleet-live:theme")).toBeNull();
    });
});
