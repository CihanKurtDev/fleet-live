import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DueKindChips } from "../components/due/DueKindChips";
import { dueKindOptions } from "../components/due/dueView";
import { FieldError } from "../components/ui/FieldError/FieldError";
import { fieldAria } from "../components/ui/FieldError/fieldAria";
import { Select } from "../components/ui/Select/Select";

describe("Select", () => {
    it("is a native select: label, value and change work as usual", () => {
        const onChange = vi.fn();
        render(
            <>
                <label htmlFor="role">Rolle</label>
                <Select id="role" value="dispatcher" onChange={onChange}>
                    <option value="dispatcher">Disponent</option>
                    <option value="viewer">Leser</option>
                </Select>
            </>,
        );

        const select = screen.getByRole("combobox", { name: "Rolle" });
        expect(select).toHaveValue("dispatcher");

        fireEvent.change(select, { target: { value: "viewer" } });
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("is described by its error like every field", () => {
        render(
            <>
                <label htmlFor="type">Fahrzeugtyp</label>
                <Select id="type" {...fieldAria("type", "Fahrzeugtyp ist ungültig.")}>
                    <option value="">—</option>
                </Select>
                <FieldError fieldId="type">Fahrzeugtyp ist ungültig.</FieldError>
            </>,
        );

        expect(
            screen.getByRole("combobox", {
                name: "Fahrzeugtyp",
                description: "Fahrzeugtyp ist ungültig.",
            }),
        ).toBeInvalid();
    });

    it("can be disabled", () => {
        render(
            <Select aria-label="Aktion" disabled>
                <option>Importieren</option>
            </Select>,
        );

        expect(screen.getByRole("combobox", { name: "Aktion" })).toBeDisabled();
    });
});

describe("kind chips on Fristen", () => {
    const kinds = dueKindOptions(
        { all: 477, licence_expiry: 128, hu: 151, uvv: 94, licence_check: 104 },
        6,
    );

    it("lists Alle and every kind with its count, one pressed", () => {
        render(<DueKindChips kinds={kinds} activeKind={null} onKind={vi.fn()} />);

        const group = screen.getByRole("group", { name: "Art" });
        expect(group).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /^Alle\s*477$/ })).toHaveAttribute(
            "aria-pressed",
            "true",
        );
        expect(screen.getByRole("button", { name: /^HU\s*151$/ })).toHaveAttribute(
            "aria-pressed",
            "false",
        );
        expect(screen.getAllByRole("button")).toHaveLength(5);
    });

    it("switches the kind, and back to Alle", () => {
        const onKind = vi.fn();
        const { rerender } = render(
            <DueKindChips kinds={kinds} activeKind={null} onKind={onKind} />,
        );

        fireEvent.click(screen.getByRole("button", { name: /^HU/ }));
        expect(onKind).toHaveBeenLastCalledWith("hu");

        rerender(<DueKindChips kinds={kinds} activeKind="hu" onKind={onKind} />);
        expect(screen.getByRole("button", { name: /^HU/ })).toHaveAttribute(
            "aria-pressed",
            "true",
        );

        fireEvent.click(screen.getByRole("button", { name: /^Alle/ }));
        expect(onKind).toHaveBeenLastCalledWith(null);
    });
});
