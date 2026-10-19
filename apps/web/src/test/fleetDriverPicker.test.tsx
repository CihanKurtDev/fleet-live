import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FleetDriver } from "@fleet-live/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FleetDriverPicker } from "../components/vehicles/FleetDriverPicker";

vi.mock("../api/vehicles", () => ({ listDrivers: vi.fn() }));
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
};

// jsdom has no scrollTo on elements.
Element.prototype.scrollTo ??= () => undefined;

import { listDrivers } from "../api/vehicles";

const drivers = (count: number): FleetDriver[] =>
    Array.from({ length: count }, (_, index) => ({
        id: index + 1,
        name: `Fahrer ${index + 1}`,
        license_plate: `K-AB ${index + 1}`,
    }));

const respond = (matches: number) => {
    vi.mocked(listDrivers).mockImplementation(async (query) => {
        if (query.search) {
            const data = drivers(Math.min(matches, 50));

            return {
                data,
                meta: { page: 1, limit: 50, total: matches, pageCount: Math.ceil(matches / 50) },
            } as never;
        }

        return { data: [], meta: { page: 1, limit: 50, total: 200, pageCount: 4 } } as never;
    });
};

const open = async (onChange = vi.fn()) => {
    render(<FleetDriverPicker selected={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Fahrer filtern" }));
    fireEvent.change(await screen.findByRole("searchbox", { name: "Name oder Kennzeichen" }), {
        target: { value: "fahrer" },
    });

    return onChange;
};

beforeEach(() => {
    vi.mocked(listDrivers).mockReset();
});

describe("Fahrer filtern", () => {
    it("selects every match of the search and applies them", async () => {
        respond(3);
        const onChange = await open();

        fireEvent.click(
            await screen.findByRole("button", { name: "Alle 3 Treffer auswählen" }),
        );
        await waitFor(() => expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(3));

        fireEvent.click(screen.getByRole("button", { name: "Übernehmen" }));
        expect(onChange).toHaveBeenCalledWith(["Fahrer 1", "Fahrer 2", "Fahrer 3"]);
    });

    it("takes at most 50 and says so", async () => {
        respond(200);
        const onChange = await open();

        fireEvent.click(
            await screen.findByRole("button", { name: "Die ersten 50 Treffer auswählen" }),
        );
        await waitFor(() => expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(50));
        expect(screen.getByRole("button", { name: "Die ersten 50 Treffer auswählen" })).toBeDisabled();

        fireEvent.click(screen.getByRole("button", { name: "Übernehmen" }));
        expect(onChange.mock.calls[0][0]).toHaveLength(50);
    });

    it("offers nothing without a search", async () => {
        respond(3);
        render(<FleetDriverPicker selected={[]} onChange={vi.fn()} />);
        fireEvent.click(screen.getByRole("button", { name: "Fahrer filtern" }));

        await screen.findByRole("searchbox", { name: "Name oder Kennzeichen" });
        expect(screen.queryByRole("button", { name: /Treffer auswählen/ })).toBeNull();
    });
});
