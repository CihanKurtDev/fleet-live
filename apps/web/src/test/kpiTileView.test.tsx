import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { KpiTileView, KpiTiles } from "../components/ui/KpiTiles/KpiTiles";

describe("KpiTileView", () => {
    it("is a link to the list its number counts when it has a target", () => {
        render(
            <MemoryRouter>
                <KpiTileView
                    surface="glass"
                    tile={{
                        key: "open",
                        label: "Offen",
                        value: 1234,
                        hint: "Warnungen",
                        tone: "critical",
                        to: "/alerts",
                    }}
                />
            </MemoryRouter>,
        );

        const link = screen.getByRole("link", { name: /Offen/ });
        expect(link).toHaveAttribute("href", "/alerts");
        expect(link).toHaveTextContent("1.234");
        expect(link).toHaveTextContent("Warnungen");
        expect(screen.queryByRole("button")).toBeNull();
    });

    it("is a pressed-state button when it filters", () => {
        const onToggle = vi.fn();
        render(
            <KpiTiles
                ariaLabel="Status"
                tiles={[
                    {
                        key: "all",
                        label: "Alle",
                        value: 12,
                        pressed: true,
                        onToggle,
                    },
                    {
                        key: "idle",
                        label: "Standby",
                        value: null,
                        pressed: false,
                        onToggle,
                    },
                ]}
            />,
        );

        const all = screen.getByRole("button", { name: "Alle, 12" });
        expect(all).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: "Standby, —" })).toHaveAttribute(
            "aria-pressed",
            "false",
        );

        fireEvent.click(screen.getByRole("button", { name: "Standby, —" }));
        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it("keeps one hint line on every tile so all tiles have one height", () => {
        const { container } = render(
            <MemoryRouter>
                <KpiTileView
                    tile={{ key: "a", label: "Auf Fahrt", value: 5, to: "/vehicles" }}
                />
            </MemoryRouter>,
        );

        expect(container.querySelectorAll("a > span")).toHaveLength(3);
    });
});
