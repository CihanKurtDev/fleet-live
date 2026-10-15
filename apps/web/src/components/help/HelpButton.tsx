import { useCallback, useState } from "react";
import { useLocation } from "react-router";

import { Button } from "../ui/Button/Button";
import { helpForPath } from "./helpContent";
import { HELP_DRAWER_ID, HelpDrawer } from "./HelpDrawer";

/** "?" in the header. Opens help for the page that is open. */
export const HelpButton = () => {
    const { pathname } = useLocation();
    const page = helpForPath(pathname);
    const [open, setOpen] = useState(false);
    const close = useCallback(() => setOpen(false), []);

    if (!page) {
        return null;
    }

    return (
        <>
            <Button
                variant="secondary"
                size="sm"
                icon
                aria-label="Hilfe zu dieser Seite"
                aria-expanded={open}
                aria-controls={open ? HELP_DRAWER_ID : undefined}
                onClick={() => setOpen((current) => !current)}
            >
                ?
            </Button>
            {open && <HelpDrawer page={page} onClose={close} />}
        </>
    );
};
