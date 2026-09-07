import styles from "./Avatar.module.scss";

type AvatarSize = "sm" | "md";

interface AvatarProps {
    name: string;
    size?: AvatarSize;
    className?: string;
}

const initialsFromName = (name: string) => {
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0] ?? "";
    const last =
        parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : (parts[0]?.[1] ?? "");
    return (first + last).toUpperCase();
};

export function Avatar({ name, size = "md", className }: AvatarProps) {
    const classes = [styles.avatar, styles[size], className]
        .filter(Boolean)
        .join(" ");

    return (
        <span className={classes} aria-hidden>
            {initialsFromName(name)}
        </span>
    );
}
