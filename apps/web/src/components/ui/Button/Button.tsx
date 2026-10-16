import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { SwapLabel } from './SwapLabel';
import styles from './Button.module.scss';

type ButtonVariant =
    | 'primary'
    | 'secondary'
    | 'ghost'
    | 'danger'
    /** Red outline: a destructive action outside a confirm dialog. */
    | 'dangerOutline';

/**
 * Heights come from the control tokens in `index.css`
 * (`rules/design-system.md`, "Control sizes"):
 * `row` = `--control-xs` (28 px): the one button inside a list row.
 * `sm` / `toolbar` = `--control-sm` (34 px): header, toolbar, panels.
 * `md` = `--control-md` (36 px): forms and dialog footers.
 * `lg` = `--control-lg` (40 px): sign-in pages.
 * Phones raise all of them to touch size.
 */
type ButtonSize = 'sm' | 'md' | 'lg' | 'toolbar' | 'row';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    children: ReactNode;
    variant?: ButtonVariant;
    size?: ButtonSize;
    fullWidth?: boolean;
    icon?: boolean;
    /** Shows `busyLabel` instead of the label without changing the width. */
    busy?: boolean;
    busyLabel?: ReactNode;
}

export function Button({
    children,
    variant = 'primary',
    size = 'md',
    fullWidth = false,
    icon = false,
    busy = false,
    busyLabel,
    className,
    type = 'button',
    ...props
}: ButtonProps) {
    const classes = [
        styles.button,
        styles[variant],
        styles[size],
        fullWidth && styles.fullWidth,
        icon && styles.icon,
        className,
    ]
    .filter(Boolean)
    .join(' ');

    return (
        <button
            type={type}
            className={classes}
            aria-busy={busyLabel !== undefined ? busy : undefined}
            {...props}
        >
            {busyLabel === undefined ? (
                children
            ) : (
                <SwapLabel swapped={busy} alt={busyLabel}>
                    {children}
                </SwapLabel>
            )}
        </button>
  );
}
