import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Modal } from "../components/ui/Modal/Modal";

// jsdom does not know showModal/close in every version.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
};

const renderModal = (guardUnsaved = false) => {
    const onClose = vi.fn();
    const view = render(
        <Modal open onClose={onClose} title="Fahrzeug anlegen" guardUnsaved={guardUnsaved}>
            <label>
                Kennzeichen
                <input type="text" />
            </label>
        </Modal>,
    );
    const dialog = view.container.querySelector("dialog") as HTMLDialogElement;

    return { onClose, dialog, field: within(dialog).getByLabelText("Kennzeichen") };
};

describe("Modal backdrop", () => {
    it("closes when the press and the click are on the backdrop", () => {
        const { onClose, dialog } = renderModal();

        fireEvent.pointerDown(dialog);
        fireEvent.click(dialog);

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("stays open when a press inside a field ends on the backdrop", () => {
        const { onClose, dialog, field } = renderModal();

        fireEvent.pointerDown(field);
        fireEvent.click(dialog);

        expect(onClose).not.toHaveBeenCalled();
    });
});

describe("Modal with unsaved input", () => {
    it("closes without asking while nothing was changed", () => {
        const { onClose, dialog } = renderModal(true);

        fireEvent.click(within(dialog).getByRole("button", { name: "Schließen", hidden: true }));

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(within(dialog).queryByText("Eingaben verwerfen?")).toBeNull();
    });

    it("asks first, keeps the input on Weiter bearbeiten and closes on Verwerfen", () => {
        const { onClose, dialog, field } = renderModal(true);

        fireEvent.input(field, { target: { value: "K-AB 1" } });
        fireEvent.click(within(dialog).getByRole("button", { name: "Schließen", hidden: true }));

        expect(onClose).not.toHaveBeenCalled();
        expect(within(dialog).getByText("Eingaben verwerfen?")).toBeInTheDocument();

        // Escape answers the question with "no".
        fireEvent.keyDown(dialog, { key: "Escape" });
        expect(within(dialog).queryByText("Eingaben verwerfen?")).toBeNull();
        expect(field).toHaveValue("K-AB 1");

        fireEvent.keyDown(dialog, { key: "Escape" });
        fireEvent.click(
            within(dialog).getByRole("button", { name: "Weiter bearbeiten", hidden: true }),
        );
        expect(onClose).not.toHaveBeenCalled();
        expect(field).toHaveValue("K-AB 1");

        fireEvent.pointerDown(dialog);
        fireEvent.click(dialog);
        fireEvent.click(within(dialog).getByRole("button", { name: "Verwerfen", hidden: true }));

        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

describe("Modal inside a modal", () => {
    // React passes close, keydown and input of the inner dialog on to the
    // outer one through the component tree; only the inner one may react.
    const renderNested = () => {
        const onOuterClose = vi.fn();
        const onInnerClose = vi.fn();
        const view = render(
            <Modal open onClose={onOuterClose} title="Termin planen" guardUnsaved>
                <label>
                    Notiz
                    <input type="text" />
                </label>
                <Modal open onClose={onInnerClose} title="Werkstatt anlegen" guardUnsaved>
                    <label>
                        Name
                        <input type="text" />
                    </label>
                </Modal>
            </Modal>,
        );
        const [outer, inner] = [...view.container.querySelectorAll("dialog")] as HTMLDialogElement[];
        return { onOuterClose, onInnerClose, outer, inner };
    };

    it("closes only the inner dialog when it closes", () => {
        const { onOuterClose, onInnerClose, inner } = renderNested();

        fireEvent(inner, new Event("close"));

        expect(onInnerClose).toHaveBeenCalledTimes(1);
        expect(onOuterClose).not.toHaveBeenCalled();
    });

    it("does not mark the outer form as changed by typing in the inner one", () => {
        const { onOuterClose, outer, inner } = renderNested();

        fireEvent.input(within(inner).getByLabelText("Name"), { target: { value: "Autohaus Weber" } });
        fireEvent.click(within(outer).getAllByRole("button", { name: "Schließen", hidden: true })[0]);

        expect(onOuterClose).toHaveBeenCalledTimes(1);
    });

    it("leaves Escape in the inner dialog to the inner dialog", () => {
        const { outer, inner } = renderNested();

        fireEvent.input(within(outer).getByLabelText("Notiz"), { target: { value: "x" } });
        const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
        within(inner).getByLabelText("Name").dispatchEvent(escape);

        expect(escape.defaultPrevented).toBe(false);
        expect(within(outer).queryByText("Eingaben verwerfen?")).toBeNull();
    });
});
