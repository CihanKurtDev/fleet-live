import { useLocation, useNavigate } from "react-router";
import type { DueListItem } from "@fleet-live/shared";

import { DueTable } from "../components/due/DueTable";

export const DuePage = () => {
    const navigate = useNavigate();
    const location = useLocation();

    const openRow = (row: DueListItem) => {
        const path =
            row.vehicle_id !== null
                ? `/vehicles/${row.vehicle_id}`
                : row.driver_id !== null
                  ? `/drivers/${row.driver_id}`
                  : null;

        if (!path) {
            return;
        }

        navigate(path, {
            state: {
                from: `${location.pathname}${location.search}`,
            },
        });
    };

    return <DueTable onSelectRow={openRow} />;
};
