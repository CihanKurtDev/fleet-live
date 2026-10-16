import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "../components/ui/Button/Button";

describe("Button busy label", () => {
    it("keeps both labels in the button and names only the visible one", () => {
        const { rerender } = render(
            <Button busy={false} busyLabel="Wird gespeichert…">
                Speichern
            </Button>,
        );

        const button = screen.getByRole("button", { name: "Speichern" });
        expect(button).toHaveAttribute("aria-busy", "false");
        // The busy text is laid out (it sets the width) but hidden.
        expect(button).toHaveTextContent("Wird gespeichert…");

        rerender(
            <Button busy busyLabel="Wird gespeichert…">
                Speichern
            </Button>,
        );

        expect(
            screen.getByRole("button", { name: "Wird gespeichert…" }),
        ).toHaveAttribute("aria-busy", "true");
    });

    it("renders a plain label without busyLabel", () => {
        render(<Button>Anlegen</Button>);

        const button = screen.getByRole("button", { name: "Anlegen" });
        expect(button).not.toHaveAttribute("aria-busy");
    });
});
