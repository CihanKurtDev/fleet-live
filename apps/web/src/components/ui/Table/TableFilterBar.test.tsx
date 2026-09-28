import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TableFilterBar } from "./TableFilterBar";

describe("TableFilterBar", () => {
    it("selects a filter and toggles the active filter off", () => {
        const onFilterChange = vi.fn();

        const { rerender } = render(
            <TableFilterBar
                filters={[
                    {
                        id: "driving",
                        displayText: "Auf Fahrt",
                        count: 12,
                    },
                ]}
                activeFilterId={null}
                onFilterChange={onFilterChange}
                showAll
            />,
        );

        fireEvent.click(
            screen.getByRole("button", { name: /Auf Fahrt\s*12/ }),
        );
        expect(onFilterChange).toHaveBeenLastCalledWith("driving");

        rerender(
            <TableFilterBar
                filters={[
                    {
                        id: "driving",
                        displayText: "Auf Fahrt",
                        count: 12,
                    },
                ]}
                activeFilterId="driving"
                onFilterChange={onFilterChange}
                showAll
            />,
        );

        fireEvent.click(
            screen.getByRole("button", { name: /Auf Fahrt\s*12/ }),
        );
        expect(onFilterChange).toHaveBeenLastCalledWith(null);
    });
});
