import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SimToggle } from "../components/SimToggle";
import { MenuButton } from "../components/ui/Menu/MenuButton";

vi.mock("../api/sim", () => ({
    getSim: vi.fn(),
    setSimRunning: vi.fn(),
}));

import { getSim, setSimRunning } from "../api/sim";

beforeEach(() => {
    vi.mocked(getSim).mockReset();
    vi.mocked(setSimRunning).mockReset();
});

describe("SimToggle", () => {
    it("holds the button's place while loading and shows nothing when there is no simulator", async () => {
        vi.mocked(getSim).mockResolvedValue({ running: true, available: false });
        const { container } = render(<SimToggle />);

        // Loading: a hidden placeholder, so the header does not shift.
        expect(container.querySelector("[aria-hidden=true]")).not.toBeNull();

        await waitFor(() => expect(container).toBeEmptyDOMElement());
    });

    it("shows nothing when the state cannot be read", async () => {
        vi.mocked(getSim).mockRejectedValue(new Error("403"));
        const { container } = render(<SimToggle />);

        await waitFor(() => expect(container).toBeEmptyDOMElement());
    });

    it("pauses and resumes the simulation of the company", async () => {
        vi.mocked(getSim).mockResolvedValue({ running: true, available: true });
        vi.mocked(setSimRunning)
            .mockResolvedValueOnce({ running: false, available: true })
            .mockResolvedValueOnce({ running: true, available: true });
        render(<SimToggle />);

        fireEvent.click(
            await screen.findByRole("button", { name: "Simulation pausieren" }),
        );
        await waitFor(() => expect(setSimRunning).toHaveBeenLastCalledWith(false));
        expect(
            await screen.findByRole("button", { name: "Simulation starten" }),
        ).toBeEnabled();

        fireEvent.click(screen.getByRole("button", { name: "Simulation starten" }));
        await waitFor(() => expect(setSimRunning).toHaveBeenLastCalledWith(true));
        expect(
            await screen.findByRole("button", { name: "Simulation pausieren" }),
        ).toBeInTheDocument();
    });

    it("says so when the change fails and keeps the state", async () => {
        vi.mocked(getSim).mockResolvedValue({ running: true, available: true });
        vi.mocked(setSimRunning).mockRejectedValue(new Error("Nur für Disponenten."));
        render(<SimToggle />);

        fireEvent.click(
            await screen.findByRole("button", { name: "Simulation pausieren" }),
        );

        expect(await screen.findByRole("alert")).toHaveTextContent(
            "Nur für Disponenten.",
        );
        expect(
            screen.getByRole("button", { name: "Simulation pausieren" }),
        ).toBeEnabled();
    });
});

describe("MenuButton", () => {
    const items = (onSelect = vi.fn()) => [
        { key: "a", label: "Fahrzeuge", onSelect: () => onSelect("a") },
        { key: "b", label: "Fahrten", onSelect: () => onSelect("b") },
    ];

    it("opens a menu, focuses its first item and runs the chosen item", async () => {
        const onSelect = vi.fn();
        render(
            <MenuButton label="Exportieren" menuLabel="Export" items={items(onSelect)} />,
        );

        const trigger = screen.getByRole("button", { name: /Exportieren/ });
        expect(trigger).toHaveAttribute("aria-expanded", "false");

        fireEvent.click(trigger);
        expect(trigger).toHaveAttribute("aria-expanded", "true");
        const menu = screen.getByRole("menu", { name: "Export" });
        expect(menu).toBeInTheDocument();
        await waitFor(() =>
            expect(screen.getByRole("menuitem", { name: "Fahrzeuge" })).toHaveFocus(),
        );

        fireEvent.click(screen.getByRole("menuitem", { name: "Fahrten" }));
        expect(onSelect).toHaveBeenCalledWith("b");
        expect(trigger).toHaveAttribute("aria-expanded", "false");
    });

    it("closes on Escape and gives the focus back to the trigger", async () => {
        render(<MenuButton label="Exportieren" menuLabel="Export" items={items()} />);
        const trigger = screen.getByRole("button", { name: /Exportieren/ });

        fireEvent.click(trigger);
        await screen.findByRole("menu");

        act(() => {
            fireEvent.keyDown(document, { key: "Escape" });
        });

        expect(trigger).toHaveAttribute("aria-expanded", "false");
        expect(trigger).toHaveFocus();
    });

    it("closes on a click outside, without taking the focus back", async () => {
        render(
            <>
                <button type="button">Daneben</button>
                <MenuButton label="Exportieren" menuLabel="Export" items={items()} />
            </>,
        );
        const trigger = screen.getByRole("button", { name: /Exportieren/ });

        fireEvent.click(trigger);
        await screen.findByRole("menu");
        fireEvent.pointerDown(screen.getByRole("button", { name: "Daneben" }));

        expect(trigger).toHaveAttribute("aria-expanded", "false");
    });

    it("turns the items into radio items when they are a choice", async () => {
        render(
            <MenuButton
                label="Weitere Filter"
                menuLabel="Filter"
                items={[
                    { key: "x", label: "Kein Fahrer", checked: true, onSelect: vi.fn() },
                    { key: "y", label: "Im Depot", checked: false, onSelect: vi.fn() },
                ]}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: /Weitere Filter/ }));

        expect(
            await screen.findByRole("menuitemradio", { name: "Kein Fahrer" }),
        ).toHaveAttribute("aria-checked", "true");
        expect(screen.getByRole("menuitemradio", { name: "Im Depot" })).toHaveAttribute(
            "aria-checked",
            "false",
        );
    });

    it("does not open while disabled", () => {
        render(
            <MenuButton label="Exportieren" menuLabel="Export" items={items()} disabled />,
        );

        fireEvent.click(screen.getByRole("button", { name: /Exportieren/ }));

        expect(screen.queryByRole("menu")).toBeNull();
    });
});
