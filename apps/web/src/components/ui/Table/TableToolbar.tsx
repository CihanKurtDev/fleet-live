import { Button } from "../Button/Button";
import styles from "./TableToolbar.module.scss";

interface TableToolbarProps {
    search: string;
    onSearchChange: (newSearch: string) => void;
    searchPlaceholder?: string;

    isEditing?: boolean;
    onToggleEditMode?: () => void;

    selectedCount?: number;
    onDeleteSelected?: () => void;

    onAddNew?: () => void;
    addNewLabel?: string;
    searchAriaLabel?: string;
}

export const TableToolbar = ({
    search,
    onSearchChange,
    searchPlaceholder = "Suchen...",
    isEditing = false,
    onToggleEditMode,
    selectedCount = 0,
    onDeleteSelected,
    onAddNew,
    addNewLabel,
    searchAriaLabel,
}: TableToolbarProps) => {
    const canDelete =
        isEditing && selectedCount > 0 && onDeleteSelected;

    return (
        <div className={styles.toolbar}>
            <div className={styles.actions}>
                {onToggleEditMode && (
                    <Button
                        variant={
                            isEditing ? "ghost" : "secondary"
                        }
                        size="sm"
                        onClick={onToggleEditMode}
                        aria-pressed={isEditing}
                    >
                        {isEditing
                            ? "Bearbeitung beenden"
                            : "Bearbeiten"}
                    </Button>
                )}

                {onAddNew && (
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={onAddNew}
                        aria-label={addNewLabel}
                    >
                        Neu
                    </Button>
                )}

                {canDelete && (
                    <Button
                        variant="danger"
                        size="sm"
                        onClick={onDeleteSelected}
                    >
                        Löschen ({selectedCount})
                    </Button>
                )}
            </div>

            <div className={styles.search}>
                <input
                    type="search"
                    className={styles.searchInput}
                    placeholder={searchPlaceholder}
                    aria-label={searchAriaLabel ?? searchPlaceholder}
                    value={search}
                    onChange={(event) =>
                        onSearchChange(event.target.value)
                    }
                />
            </div>
        </div>
    );
};
