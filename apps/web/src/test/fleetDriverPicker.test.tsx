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

const open = async (props: Partial<Parameters<typeof FleetDriverPicker>[0]> = {}) => {
    const onChange = vi.fn();
    const onSearchText = vi.fn();
    render(
        <FleetDriverPicker
            selected={[]}
            onChange={onChange}
            onSearchText={onSearchText}
            {...props}
        />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Fahrer/ }));
    fireEvent.change(await screen.findByRole("searchbox", { name: "Name oder Kennzeichen" }), {
        target: { value: "fahrer" },
    });

    return { onChange, onSearchText };
};

beforeEach(() => {
    vi.mocked(listDrivers).mockReset();
});

describe("Fahrer filtern", () => {
    it("filters by the text of the search: every match, without a list of names", async () => {
        respond(200);
        const { onSearchText, onChange } = await open();

        fireEvent.click(
            await screen.findByRole("button", { name: "Alle 200 Treffer filtern" }),
        );

        expect(onSearchText).toHaveBeenCalledWith("fahrer");
        expect(onChange).not.toHaveBeenCalled();
        // The dialog closes with the filter set.
        await waitFor(() => expect(screen.queryByRole("searchbox")).toBeNull());
    });

    it("says Treffer filtern for a single match", async () => {
        respond(1);
        await open();

        expect(await screen.findByRole("button", { name: "Treffer filtern" })).toBeInTheDocument();
    });

    it("still picks single drivers by name", async () => {
        respond(3);
        const { onChange } = await open();

        const rows = await screen.findAllByRole("checkbox");
        fireEvent.click(rows[0]);
        fireEvent.click(screen.getByRole("button", { name: "Übernehmen" }));

        expect(onChange).toHaveBeenCalledWith(["Fahrer 1"]);
    });

    it("shows the active text on the trigger and clears it with Auswahl aufheben", async () => {
        respond(3);
        const onSearchText = vi.fn();
        render(
            <FleetDriverPicker
                selected={[]}
                onChange={vi.fn()}
                searchText="2"
                onSearchText={onSearchText}
            />,
        );

        const trigger = screen.getByRole("button", { name: "Fahrer: Suche „2“" });
        expect(trigger).toHaveTextContent("Suche „2“");

        fireEvent.click(trigger);
        fireEvent.click(await screen.findByRole("button", { name: "Auswahl aufheben" }));

        expect(onSearchText).toHaveBeenCalledWith("");
    });

    it("offers nothing without a search", async () => {
        respond(3);
        render(<FleetDriverPicker selected={[]} onChange={vi.fn()} />);
        fireEvent.click(screen.getByRole("button", { name: "Fahrer filtern" }));

        await screen.findByRole("searchbox", { name: "Name oder Kennzeichen" });
        expect(screen.queryByRole("button", { name: /Treffer filtern/ })).toBeNull();
    });
});
