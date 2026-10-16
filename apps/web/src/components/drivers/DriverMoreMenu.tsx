import { MenuButton } from "../ui/Menu/MenuButton";

interface DriverMoreMenuProps {
    onDelete: () => void;
}

/** "⋯" next to Bearbeiten. Holds the rare, destructive driver actions. */
export const DriverMoreMenu = ({ onDelete }: DriverMoreMenuProps) => (
    <MenuButton
        label={<span aria-hidden="true">⋯</span>}
        ariaLabel="Weitere Aktionen"
        menuLabel="Weitere Aktionen"
        caret={false}
        size="toolbar"
        items={[
            {
                key: "delete",
                label: "Fahrer löschen",
                tone: "danger",
                onSelect: onDelete,
            },
        ]}
    />
);
