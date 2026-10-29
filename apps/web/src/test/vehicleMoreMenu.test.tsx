import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { VehicleMoreMenu } from "../components/vehicles/VehicleMoreMenu";

describe("VehicleMoreMenu", () => {
    it("keeps delete behind Weitere Aktionen and closes after choosing it", () => {
        const onDelete = vi.fn();

        render(
            <VehicleMoreMenu
                availability="READY"
                onOutOfService={vi.fn()}
                onDelete={onDelete}
            />,
        );

        expect(
            screen.queryByRole("menuitem", { name: "Fahrzeug löschen" }),
        ).not.toBeInTheDocument();

        const trigger = screen.getByRole("button", {
            name: "Weitere Aktionen",
        });
        expect(trigger).toHaveAttribute("aria-expanded", "false");

        fireEvent.click(trigger);
        expect(trigger).toHaveAttribute("aria-expanded", "true");

        fireEvent.click(
            screen.getByRole("menuitem", { name: "Fahrzeug löschen" }),
        );

        expect(onDelete).toHaveBeenCalledTimes(1);
        expect(
            screen.queryByRole("menu", { name: "Weitere Aktionen" }),
        ).not.toBeInTheDocument();
    });

    it("closes on Escape without deleting", () => {
        const onDelete = vi.fn();

        render(
            <VehicleMoreMenu
                availability="READY"
                onOutOfService={vi.fn()}
                onDelete={onDelete}
            />,
        );
        fireEvent.click(
            screen.getByRole("button", { name: "Weitere Aktionen" }),
        );
        expect(
            screen.getByRole("menu", { name: "Weitere Aktionen" }),
        ).toBeInTheDocument();

        fireEvent.keyDown(document, { key: "Escape" });

        expect(
            screen.queryByRole("menu", { name: "Weitere Aktionen" }),
        ).not.toBeInTheDocument();
        expect(onDelete).not.toHaveBeenCalled();
    });
});
