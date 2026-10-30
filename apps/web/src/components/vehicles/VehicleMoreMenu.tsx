import type { VehicleAvailability } from "@fleet-live/shared";

import { MenuButton } from "../ui/Menu/MenuButton";

interface VehicleMoreMenuProps {
    availability: VehicleAvailability;
    onReportDamage?: () => void;
    onOutOfService: (outOfService: boolean) => void;
    onDelete: () => void;
}

/**
 * "⋯" next to Bearbeiten. Holds the rare vehicle actions: taking it out of
 * service (not while it is in a workshop) and deleting it.
 */
export const VehicleMoreMenu = ({
    availability,
    onReportDamage,
    onOutOfService,
    onDelete,
}: VehicleMoreMenuProps) => (
    <MenuButton
        label={<span aria-hidden="true">⋯</span>}
        ariaLabel="Weitere Aktionen"
        menuLabel="Weitere Aktionen"
        caret={false}
        size="toolbar"
        items={[
            ...(onReportDamage
                ? [{ key: "damage", label: "Schaden melden", onSelect: onReportDamage }]
                : []),
            ...(availability === "OUT_OF_SERVICE"
                ? [
                      {
                          key: "in-service",
                          label: "Wieder in Dienst stellen",
                          onSelect: () => onOutOfService(false),
                      },
                  ]
                : availability === "READY"
                  ? [
                        {
                            key: "out-of-service",
                            label: "Außer Dienst stellen",
                            onSelect: () => onOutOfService(true),
                        },
                    ]
                  : []),
            {
                key: "delete",
                label: "Fahrzeug löschen",
                tone: "danger",
                onSelect: onDelete,
            },
        ]}
    />
);
