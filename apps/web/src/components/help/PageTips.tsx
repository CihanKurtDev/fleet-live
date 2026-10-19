import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useAuth } from "../../hooks/useAuth";
import { readFlag, userKey, writeFlag } from "../../utils/localFlags";
import {
    onPageTipsRequest,
    tipsForRole,
    type TipPageId,
} from "./tipCatalog";
import styles from "./PageTips.module.scss";

type Placement = {
    ring: { top: number; left: number; width: number; height: number };
    card: { left: number; top?: number; bottom?: number };
    arrowLeft: number;
    above: boolean;
};

/** How long a tip waits for its element before it is skipped. */
const TARGET_WAIT_MS = 5000;
const CARD_WIDTH = 300;
const CARD_HEIGHT_GUESS = 170;
const GAP = 12;
const EDGE = 16;

const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), Math.max(min, max));

function placeNear(target: Element): Placement {
    const rect = target.getBoundingClientRect();
    const viewWidth = window.innerWidth;
    const viewHeight = window.innerHeight;
    const width = Math.min(CARD_WIDTH, viewWidth - EDGE * 2);
    const left = clamp(rect.left + 8, EDGE, viewWidth - width - EDGE);
    const above =
        rect.bottom + GAP + CARD_HEIGHT_GUESS > viewHeight &&
        rect.top - GAP - CARD_HEIGHT_GUESS > 0;

    return {
        ring: {
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
        },
        card: above
            ? { left, bottom: viewHeight - rect.top + GAP }
            : { left, top: rect.bottom + GAP },
        arrowLeft: clamp(rect.left + 24 - left, 16, width - 24),
        above,
    };
}

/** The first element of that name that is shown (a hidden one has no box). */
const findTarget = (name: string) =>
    [...document.querySelectorAll(`[data-tip="${name}"]`)].find(
        (element) => element.checkVisibility?.() ?? true,
    ) ?? null;

/**
 * Short coach marks for one page. They show once per person; the help drawer
 * can bring them back ("Tipps auf dieser Seite noch einmal zeigen").
 */
export const PageTips = ({ page }: { page: TipPageId }) => {
    const { user } = useAuth();
    const tips = tipsForRole(page, user?.role);
    const seenKey = user ? userKey(`tips-${page}`, user) : null;
    const [index, setIndex] = useState<number | null>(() =>
        seenKey && !readFlag(seenKey) ? 0 : null,
    );
    const [placement, setPlacement] = useState<Placement | null>(null);
    const [wantsFocus, setWantsFocus] = useState(false);
    const nextRef = useRef<HTMLButtonElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const titleId = useId();
    const tip = index === null ? null : (tips[index] ?? null);

    const finish = () => {
        if (seenKey) {
            writeFlag(seenKey);
        }

        setIndex(null);
        setPlacement(null);
        setWantsFocus(false);
    };

    useEffect(
        () =>
            onPageTipsRequest(page, () => {
                setPlacement(null);
                setIndex(0);
                setWantsFocus(true);
            }),
        [page],
    );

    // Place the card next to its target and follow scrolling and resizing.
    // A tip whose target is not on the page is skipped.
    useEffect(() => {
        if (!tip || index === null) {
            return;
        }

        let frame = 0;
        let last = "";
        const startedAt = performance.now();
        // Measured every frame while the tip is open: content that loads later
        // (the first-steps line, charts) moves the target without a scroll or
        // resize event, and the ring must follow it.
        const measure = () => {
            const target = findTarget(tip.target);

            if (!target) {
                // A list page draws its tiles only once the data is there.
                if (performance.now() - startedAt < TARGET_WAIT_MS) {
                    frame = requestAnimationFrame(measure);
                    return;
                }

                setPlacement(null);
                setIndex((current) =>
                    current === null || current + 1 >= tips.length
                        ? null
                        : current + 1,
                );
                return;
            }

            const next = placeNear(target);
            const key = JSON.stringify(next);

            if (key !== last) {
                last = key;
                setPlacement(next);
            }

            frame = requestAnimationFrame(measure);
        };

        findTarget(tip.target)?.scrollIntoView?.({ block: "nearest" });
        frame = requestAnimationFrame(measure);

        return () => cancelAnimationFrame(frame);
    }, [tip, index, tips.length]);

    useEffect(() => {
        if (wantsFocus && placement) {
            nextRef.current?.focus();
        }
    }, [wantsFocus, placement]);

    useEffect(() => {
        if (!tip) {
            return;
        }

        const onKey = (event: KeyboardEvent) => {
            // An Escape meant for a menu or dialog (focus is inside it) is
            // not an answer to the tip.
            const active = document.activeElement;
            const elsewhere =
                active !== null &&
                active !== document.body &&
                !cardRef.current?.contains(active);

            if (event.key === "Escape" && !elsewhere) {
                if (seenKey) {
                    writeFlag(seenKey);
                }

                setIndex(null);
                setPlacement(null);
                setWantsFocus(false);
            }
        };

        document.addEventListener("keydown", onKey);

        return () => document.removeEventListener("keydown", onKey);
    }, [tip, seenKey]);

    if (!tip || index === null || !placement) {
        return null;
    }

    const isLast = index === tips.length - 1;

    return createPortal(
        <>
            <div
                className={styles.ring}
                style={placement.ring}
                aria-hidden="true"
            />
            <div
                ref={cardRef}
                className={styles.card}
                style={{ ...placement.card, width: Math.min(CARD_WIDTH, window.innerWidth - EDGE * 2) }}
                role="dialog"
                aria-modal="false"
                aria-labelledby={titleId}
            >
                <span
                    className={placement.above ? styles.arrowBelow : styles.arrowAbove}
                    style={{ left: placement.arrowLeft }}
                    aria-hidden="true"
                />
                <strong id={titleId} className={styles.title}>
                    {tip.title}
                </strong>
                <p className={styles.body}>{tip.body}</p>
                <div className={styles.footer}>
                    <span className={styles.count}>
                        Tipp {index + 1} von {tips.length}
                    </span>
                    <span className={styles.actions}>
                        <button
                            type="button"
                            className={styles.skip}
                            onClick={finish}
                        >
                            Überspringen
                        </button>
                        <button
                            ref={nextRef}
                            type="button"
                            className={styles.next}
                            onClick={() => {
                                if (isLast) {
                                    finish();
                                    return;
                                }

                                setWantsFocus(true);
                                setIndex(index + 1);
                            }}
                        >
                            {isLast ? "Fertig" : "Weiter"}
                        </button>
                    </span>
                </div>
            </div>
        </>,
        document.body,
    );
};
