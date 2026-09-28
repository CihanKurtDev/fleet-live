import { Button } from "./Button/Button";
import styles from "./RetryMessage.module.scss";

type RetryMessageProps = {
    message: string;
    onRetry: () => void;
};

export const RetryMessage = ({
    message,
    onRetry,
}: RetryMessageProps) => (
    <div className={styles.message} role="alert">
        <p>{message}</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
            Erneut versuchen
        </Button>
    </div>
);
