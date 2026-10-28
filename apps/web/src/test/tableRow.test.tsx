import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TableRow } from "../components/ui/Table/TableRow";
import type { TableColumn } from "../types/table";

type Row = { id: number; name: string };

const columns: TableColumn<Row>[] = [
    { key: "name", displayText: "Name" },
    {
        key: "id",
        displayText: "Aktion",
        render: () => <button type="button">Erledigen</button>,
    },
];

const renderRow = (onClick: () => void, onIntent?: () => void) =>
    render(
        <table>
            <tbody>
                <TableRow
                    rowData={{ id: 1, name: "K-AB 1" }}
                    columns={columns}
                    isSelected={false}
                    isEditing={false}
                    interactive
                    onSelect={() => undefined}
                    onClick={onClick}
                    onIntent={onIntent}
                />
            </tbody>
        </table>,
    );

describe("TableRow keyboard", () => {
    it("opens the row on Enter at the row", () => {
        const onClick = vi.fn();
        renderRow(onClick);

        fireEvent.keyDown(screen.getByRole("row"), { key: "Enter" });

        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("leaves Enter on a row button to that button", () => {
        const onClick = vi.fn();
        renderRow(onClick);

        const event = fireEvent.keyDown(
            screen.getByRole("button", { name: "Erledigen" }),
            { key: "Enter" },
        );

        expect(onClick).not.toHaveBeenCalled();
        // Not cancelled: the browser still activates the button.
        expect(event).toBe(true);
    });
});

describe("TableRow intent", () => {
    it("reports a likely click when the pointer enters or the row gets focus", () => {
        const onIntent = vi.fn();
        renderRow(() => undefined, onIntent);
        const row = screen.getByRole("row");

        fireEvent.pointerEnter(row);
        fireEvent.focus(row);

        expect(onIntent).toHaveBeenCalledTimes(2);
    });

    it("does not count focus on a row button", () => {
        const onIntent = vi.fn();
        renderRow(() => undefined, onIntent);

        fireEvent.focus(screen.getByRole("button", { name: "Erledigen" }));

        expect(onIntent).not.toHaveBeenCalled();
    });
});
