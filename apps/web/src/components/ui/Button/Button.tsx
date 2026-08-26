import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.scss';

type ButtonVariant =
    | 'primary'
    | 'secondary'
    | 'ghost'
    | 'danger';

type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    children: ReactNode;
    variant?: ButtonVariant;
    size?: ButtonSize;
    fullWidth?: boolean;
    icon?: boolean;
}

export function Button({
    children,
    variant = 'primary',
    size = 'md',
    fullWidth = false,
    icon = false,
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
            {...props}
        >
            {children}
        </button>
  );
}