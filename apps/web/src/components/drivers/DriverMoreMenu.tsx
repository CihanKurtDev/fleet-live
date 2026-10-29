import { MenuButton } from "../ui/Menu/MenuButton";

interface DriverMoreMenuProps {
    onExport: () => void;
    onDelete: () => void;
}

/** "⋯" next to Bearbeiten. Holds the rare driver actions: the Auskunft and deleting. */
export const DriverMoreMenu = ({ onExport, onDelete }: DriverMoreMenuProps) => (
    <MenuButton
        label={<span aria-hidden="true">⋯</span>}
        ariaLabel="Weitere Aktionen"
        menuLabel="Weitere Aktionen"
        caret={false}
        size="toolbar"
        items={[
            {
                key: "export",
                label: "Auskunft exportieren",
                onSelect: onExport,
            },
            {
                key: "delete",
                label: "Fahrer löschen",
                tone: "danger",
                onSelect: onDelete,
            },
        ]}
    />
);
