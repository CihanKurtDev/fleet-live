import { Link } from "react-router";

import { useAuth } from "../../hooks/useAuth";
import { useFirstSteps } from "../../hooks/useFirstSteps";
import { Button } from "../ui/Button/Button";
import styles from "./FirstSteps.module.scss";

const titles = (steps: Array<{ title: string }>) =>
    steps.map((step) => step.title).join(", ");

/**
 * Setup checklist in the Schicht title row: the count, a thin bar and the
 * open steps as links to the page where each is done. Done steps only count.
 * On wide windows only the first one or two open steps show as links, the
 * rest as "+N". The line goes away once every step is done or the
 * dispatcher hides it.
 */
export const FirstSteps = ({ className }: { className?: string }) => {
    const { user } = useAuth();
    const { steps, hide } = useFirstSteps(user);
    const done = steps.filter((step) => step.done);
    const open = steps.filter((step) => !step.done);

    if (steps.length === 0 || open.length === 0) {
        return null;
    }

    const doneSummary =
        done.length > 0
            ? `Erledigt: ${done
                  .map((step) => `${step.title} (${step.doneHint})`)
                  .join(", ")}`
            : undefined;

    return (
        <aside
            className={[styles.panel, className].filter(Boolean).join(" ")}
            aria-labelledby="first-steps-title"
        >
            <h2 id="first-steps-title" className={styles.title}>
                Erste Schritte
            </h2>
            <span className={styles.count} title={doneSummary}>
                {done.length} von {steps.length}
            </span>
            <span
                className={styles.bar}
                role="progressbar"
                aria-label="Erste Schritte"
                aria-valuemin={0}
                aria-valuemax={steps.length}
                aria-valuenow={done.length}
                aria-valuetext={`${done.length} von ${steps.length} erledigt`}
            >
                <span
                    className={styles.barFill}
                    style={{ width: `${(done.length / steps.length) * 100}%` }}
                />
            </span>
            <ul className={styles.steps}>
                {open.map((step, index) => (
                    <li
                        key={step.id}
                        className={
                            index === 0
                                ? undefined
                                : index === 1
                                  ? styles.second
                                  : styles.extra
                        }
                    >
                        <Link className={styles.chip} to={step.to} title={step.hint}>
                            {step.title}
                            <span className={styles.arrow} aria-hidden="true">
                                →
                            </span>
                        </Link>
                    </li>
                ))}
                {open.length > 1 && (
                    <li
                        className={styles.moreNarrow}
                        title={titles(open.slice(1))}
                        aria-hidden="true"
                    >
                        +{open.length - 1}
                    </li>
                )}
                {open.length > 2 && (
                    <li
                        className={styles.moreWide}
                        title={titles(open.slice(2))}
                        aria-hidden="true"
                    >
                        +{open.length - 2}
                    </li>
                )}
            </ul>
            <Button
                variant="ghost"
                size="sm"
                className={styles.hide}
                aria-label="Erste Schritte ausblenden"
                onClick={hide}
            >
                Ausblenden
            </Button>
        </aside>
    );
};
