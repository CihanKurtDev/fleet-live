import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { registerAccount } from "../api/auth";
import { ApiError } from "../api/client";
import { Button } from "../components/ui/Button/Button";
import { Input } from "../components/ui/Input/Input";
import styles from "./LoginPage.module.scss";

export const RegisterPage = () => {
    const [companyName, setCompanyName] = useState("");
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [fields, setFields] = useState<Record<string, string>>({});
    const [pending, setPending] = useState(false);

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setError(null);
        setFields({});
        setPending(true);

        try {
            const result = await registerAccount({
                company_name: companyName,
                name,
                email,
                password,
            });
            setMessage(result.message);
        } catch (caught: unknown) {
            if (caught instanceof ApiError) {
                setError(caught.message);
                setFields(caught.fields ?? {});
                return;
            }

            setError("Registrierung ist fehlgeschlagen.");
        } finally {
            setPending(false);
        }
    };

    return (
        <section className={styles.page}>
            <div className={styles.card}>
                <header className={styles.header}>
                    <h1 className={styles.title}>Firma registrieren</h1>
                    <p className={styles.lead}>
                        Du legst die Firma an und bist der erste Dispatcher.
                        Die E-Mail muss bestätigt sein, bevor der Login gilt.
                    </p>
                </header>
                {message ? (
                    <p className={styles.notice} role="status">
                        {message}
                    </p>
                ) : (
                    <form className={styles.form} onSubmit={submit}>
                        <Field
                            id="company"
                            label="Firmenname"
                            value={companyName}
                            error={fields.company_name}
                            onChange={setCompanyName}
                        />
                        <Field
                            id="name"
                            label="Dein Name"
                            value={name}
                            error={fields.name}
                            onChange={setName}
                        />
                        <Field
                            id="email"
                            label="E-Mail"
                            type="email"
                            value={email}
                            error={fields.email}
                            onChange={setEmail}
                        />
                        <Field
                            id="password"
                            label="Passwort"
                            type="password"
                            value={password}
                            error={fields.password}
                            onChange={setPassword}
                        />
                        {error && (
                            <p className={styles.banner} role="alert">
                                {error}
                            </p>
                        )}
                        <Button type="submit" fullWidth size="lg" disabled={pending}>
                            {pending ? "Wird angelegt…" : "Registrieren"}
                        </Button>
                    </form>
                )}
                <p className={styles.links}>
                    <Link to="/login">Zur Anmeldung</Link>
                </p>
            </div>
        </section>
    );
};

const Field = ({
    id,
    label,
    value,
    error,
    onChange,
    type = "text",
}: {
    id: string;
    label: string;
    value: string;
    error?: string;
    onChange: (value: string) => void;
    type?: string;
}) => (
    <div className={styles.field}>
        <label htmlFor={id}>{label}</label>
        <Input
            id={id}
            type={type}
            size="lg"
            fullWidth
            required
            minLength={type === "password" ? 12 : undefined}
            maxLength={type === "password" ? 128 : 120}
            value={value}
            onChange={(event) => onChange(event.target.value)}
        />
        {error && <p className={styles.error}>{error}</p>}
    </div>
);
