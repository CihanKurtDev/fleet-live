import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FieldError } from "../components/ui/FieldError/FieldError";
import { fieldAria } from "../components/ui/FieldError/fieldAria";
import { Input } from "../components/ui/Input/Input";
import { VehicleForm } from "../components/vehicles/VehicleForm";
import { DriverCreateForm } from "../components/drivers/DriverCreateForm";

vi.mock("../api/sites", () => ({
    listSites: vi.fn().mockResolvedValue({ data: [] }),
}));
vi.mock("../hooks/useDueSettings", () => ({
    useDueSettings: () => ({ settings: null }),
}));

beforeEach(() => {
    vi.clearAllMocks();
});

describe("fieldAria", () => {
    it("marks a field valid and describes it by nothing without an error", () => {
        expect(fieldAria("plate", undefined)).toEqual({
            "aria-invalid": false,
            "aria-describedby": undefined,
        });
    });

    it("lists the hints first and the error last", () => {
        expect(fieldAria("hu", "Pflicht", "hu-reason")).toEqual({
            "aria-invalid": true,
            "aria-describedby": "hu-reason hu-error",
        });
        expect(fieldAria("hu", undefined, "hu-reason")["aria-describedby"]).toBe(
            "hu-reason",
        );
    });
});

describe("a field and its error text", () => {
    it("lets a screen reader read the error as the description of the field", () => {
        render(
            <>
                <label htmlFor="x">Kennzeichen</label>
                <Input id="x" {...fieldAria("x", "Pflichtfeld.")} />
                <FieldError fieldId="x">Pflichtfeld.</FieldError>
            </>,
        );

        expect(
            screen.getByRole("textbox", {
                name: "Kennzeichen",
                description: "Pflichtfeld.",
            }),
        ).toBeInvalid();
    });

    it("renders nothing without an error", () => {
        const { container } = render(<FieldError fieldId="x">{undefined}</FieldError>);

        expect(container).toBeEmptyDOMElement();
    });
});

describe("forms", () => {
    it("describes the vehicle plate by its error and keeps the hint of the HU field", async () => {
        const onSubmit = vi.fn();
        render(<VehicleForm submitLabel="Speichern" onSubmit={onSubmit} />);

        fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

        const plate = await screen.findByRole("textbox", {
            name: /Kennzeichen/,
            description: "Kennzeichen ist erforderlich.",
        });
        expect(plate).toBeInvalid();
        expect(onSubmit).not.toHaveBeenCalled();

        const hu = screen.getByLabelText(/HU fällig/);
        expect(hu.getAttribute("aria-describedby")).toMatch(/-hu-reason$/);
    });

    it("describes the driver name by its error", async () => {
        render(<DriverCreateForm onCreated={vi.fn()} />);

        fireEvent.click(screen.getByRole("button", { name: "Anlegen" }));

        await waitFor(() =>
            expect(
                screen.getByRole("textbox", {
                    name: /Name/,
                    description: "Name ist erforderlich.",
                }),
            ).toBeInvalid(),
        );
    });
});
