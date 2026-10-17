import styles from "./Button.module.scss";

/**
 * Classes of a `Button` for a link that should look like one (same height,
 * font and states), e.g. a router `Link` next to buttons in a header.
 */
export const buttonClass = (
    variant: "primary" | "secondary" | "ghost" = "secondary",
    size: "sm" | "md" | "toolbar" = "sm",
) => [styles.button, styles[variant], styles[size]].join(" ");
