import { useLocation, useNavigate } from "react-router";

import { readBackTarget } from "./detailBack";

export const useDetailBack = (fallback: string) => {
    const location = useLocation();
    const navigate = useNavigate();
    const { from, fromHistory } = readBackTarget(location.state, fallback);

    return { from, fromHistory, navigate };
};
