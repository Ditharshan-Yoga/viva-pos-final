import React, { useState } from "react";
import { router, Head } from "@inertiajs/react";
import { Pizza, Delete, LockKeyhole } from "lucide-react";
import { Row } from "./ui";
export default function Login({
    business,
    errors = {},
}: {
    business: string;
    errors?: Row;
}) {
    const [pin, setPin] = useState(""),
        [busy, setBusy] = useState(false);
    const submit = () => {
        if (pin.length < 4 || busy) return;
        setBusy(true);
        router.post(
            "/login",
            { pin, device: navigator.platform },
            { onFinish: () => setBusy(false), onError: () => setPin("") },
        );
    };
    return (
        <div className="login-wrap">
            <Head title="Sign in" />
            <section className="login-brand">
                <div className="brand-mark">
                    <Pizza size={34} />
                </div>
                <span className="eyebrow">PIZZA · BAR · GOOD TIMES</span>
                <h1>{business}</h1>
                <p>
                    A little less tapping.
                    <br />A little more hospitality.
                </p>
                <div className="brand-line">The floor is yours.</div>
            </section>
            <section className="login-panel">
                <span className="eyebrow">WELCOME BACK</span>
                <h2>Enter your PIN</h2>
                <p className="muted mb-5">
                    Your PIN opens your staff workspace.
                </p>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        submit();
                    }}
                >
                    <input
                        autoFocus
                        className="pin-input"
                        aria-label="Security PIN"
                        type="password"
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={8}
                        value={pin}
                        onChange={(e) =>
                            setPin(e.target.value.replace(/\D/g, ""))
                        }
                    />
                    <div className="keypad">
                        {[
                            "1",
                            "2",
                            "3",
                            "4",
                            "5",
                            "6",
                            "7",
                            "8",
                            "9",
                            "Clear",
                            "0",
                            "⌫",
                        ].map((n) => (
                            <button
                                disabled={busy}
                                key={n}
                                type="button"
                                aria-label={n === "⌫" ? "Backspace" : n}
                                onClick={() =>
                                    setPin(
                                        n === "Clear"
                                            ? ""
                                            : n === "⌫"
                                              ? pin.slice(0, -1)
                                              : (pin + n).slice(0, 8),
                                    )
                                }
                            >
                                {n === "⌫" ? <Delete size={24} /> : n}
                            </button>
                        ))}
                    </div>
                    {Object.values(errors).map((err, i) => (
                        <p className="error" role="alert" key={i}>
                            {String(err)}
                        </p>
                    ))}
                    <button
                        className="primary full"
                        disabled={busy || pin.length < 4}
                    >
                        <LockKeyhole size={18} />
                        {busy ? "Signing in…" : "Sign in"}
                    </button>
                </form>
            </section>
        </div>
    );
}
