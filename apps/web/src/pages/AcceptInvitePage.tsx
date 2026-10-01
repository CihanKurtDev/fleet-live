import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { acceptInvite } from "../api/auth";
import { ApiError } from "../api/client";
import { Button } from "../components/ui/Button/Button";
import { Input } from "../components/ui/Input/Input";
import { useAuth } from "../hooks/useAuth";
import styles from "./LoginPage.module.scss";

export const AcceptInvitePage = () => {
    const [params] = useSearchParams();
    const token = params.get("token") ?? "";
    const navigate = useNavigate();
    const { setUser } = useAuth();
    const [name, setName] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(
        token ? null : "Der Link ist ungültig oder abgelaufen.",
    );
    const [pending, setPending] = useState(false);

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setPending(true);
        setError(null);

        try {
            const user = await acceptInvite({ token, name, password });
            setUser(user);
            navigate("/", { replace: true });
        } catch (caught: unknown) {
            setError(
                caught instanceof ApiError
                    ? caught.message
                    : "Die Einladung konnte nicht angenommen werden.",
            );
        } finally {
            setPending(false);
        }
    };

    return (
        <section className={styles.page}>
            <div className={styles.card}>
                <header className={styles.header}>
                    <h1 className={styles.title}>Einladung annehmen</h1>
                    <p className={styles.lead}>
                        Lege deinen Namen und ein Passwort fest. Danach bist
                        du in der Firma angemeldet.
                    </p>
                </header>
                <form className={styles.form} onSubmit={submit}>
                    <div className={styles.field}>
                        <label htmlFor="name">Name</label>
                        <Input
                            id="name"
                            size="lg"
                            fullWidth
                            required
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                        />
                    </div>
                    <div className={styles.field}>
                        <label htmlFor="password">Passwort</label>
                        <Input
                            id="password"
                            type="password"
                            size="lg"
                            fullWidth
                            required
                            minLength={12}
                            maxLength={128}
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                        />
                    </div>
                    {error && (
                        <p className={styles.banner} role="alert">
                            {error}
                        </p>
                    )}
                    <Button type="submit" fullWidth size="lg" disabled={pending || !token}>
                        Einladung annehmen
                    </Button>
                </form>
                <p className={styles.links}>
                    <Link to="/login">Zur Anmeldung</Link>
                </p>
            </div>
        </section>
    );
};
