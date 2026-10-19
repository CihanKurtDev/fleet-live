import { Outlet } from "react-router";
import layout from "../styles/layout.module.scss";

/** Pages that keep the readable column width. */
export function WideLayout() {
    return (
        <div className={layout.wide}>
            <Outlet />
        </div>
    );
}

/** Pages that use the whole window (maps, lists). */
export function FullLayout() {
    return (
        <div className={layout.full} data-layout="full">
            <Outlet />
        </div>
    );
}
