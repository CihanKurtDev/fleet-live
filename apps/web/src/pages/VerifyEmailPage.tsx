import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { verifyEmail } from "../api/auth";
import { ApiError } from "../api/client";
import styles from "./LoginPage.module.scss";

export const VerifyEmailPage = () => {
    const [params] = useSearchParams();
    const token = params.get("token") ?? "";
    const [message, setMessage] = useState(
        token ? "E-Mail wird bestätigt…" : "Der Link ist ungültig oder abgelaufen.",
    );

    useEffect(() => {
        if (!token) {
            return;
        }

        let cancelled = false;
        verifyEmail(token)
            .then(() => {
                if (!cancelled) {
                    setMessage("Die E-Mail ist bestätigt. Du kannst dich anmelden.");
                }
            })
            .catch((caught: unknown) => {
                if (!cancelled) {
                    setMessage(
                        caught instanceof ApiError
                            ? caught.message
                            : "Der Link ist ungültig oder abgelaufen.",
                    );
                }
            });

        return () => {
            cancelled = true;
        };
    }, [token]);

    return (
        <section className={styles.page}>
            <div className={styles.card}>
                <header className={styles.header}>
                    <h1 className={styles.title}>E-Mail bestätigen</h1>
                    <p className={styles.lead}>{message}</p>
                </header>
                <p className={styles.links}>
                    <Link to="/login">Zur Anmeldung</Link>
                </p>
            </div>
        </section>
    );
};
