import { useLocation, useNavigate } from "react-router";

import { DriverTable } from "../components/drivers/DriverTable";

export const DriversPage = () => {
    const navigate = useNavigate();
    const location = useLocation();

    return (
        <DriverTable
            onSelectDriver={(driver) => {
                navigate(`/drivers/${driver.id}`, {
                    state: {
                        from: `${location.pathname}${location.search}`,
                    },
                });
            }}
        />
    );
};
