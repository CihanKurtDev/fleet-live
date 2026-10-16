import { MenuButton } from "../ui/Menu/MenuButton";

interface VehicleMoreMenuProps {
    onDelete: () => void;
}

/** "⋯" next to Bearbeiten. Holds the rare, destructive vehicle actions. */
export const VehicleMoreMenu = ({ onDelete }: VehicleMoreMenuProps) => (
    <MenuButton
        label={<span aria-hidden="true">⋯</span>}
        ariaLabel="Weitere Aktionen"
        menuLabel="Weitere Aktionen"
        caret={false}
        size="toolbar"
        items={[
            {
                key: "delete",
                label: "Fahrzeug löschen",
                tone: "danger",
                onSelect: onDelete,
            },
        ]}
    />
);
