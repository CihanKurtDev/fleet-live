import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MissingDriver } from "../components/drivers/MissingDriver";
import { authUser, renderAuth } from "./renderAuth";

describe("a missing driver name", () => {
    it("says when the company keeps names from this viewer", () => {
        renderAuth(<MissingDriver fallback="nicht erfasst" />, {
            user: authUser({ role: "viewer", driver_names_hidden: true }),
        });

        expect(screen.getByText("nur für Dispatcher")).toBeInTheDocument();
    });

    it("says it was not recorded otherwise", () => {
        renderAuth(<MissingDriver fallback="nicht erfasst" />, { user: authUser() });

        expect(screen.getByText("nicht erfasst")).toBeInTheDocument();
    });
});
