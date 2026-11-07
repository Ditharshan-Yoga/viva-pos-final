import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { X, LoaderCircle } from "lucide-react";
export type Row = Record<string, any>;
export const CurrencyContext = createContext("CAD");
export function useMoney(override?: string) {
    const currency = useContext(CurrencyContext);
    const formatter = new Intl.NumberFormat("en-CA", {
        style: "currency",
        currency: override || currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    return (cents: number = 0) => formatter.format(cents / 100);
}
export const timestamp = (
    s: string | undefined,
    tz: string = "America/Toronto",
) =>
    s
        ? new Intl.DateTimeFormat("en-CA", {
              timeZone: tz,
              dateStyle: "medium",
              timeStyle: "short",
          }).format(new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z"))
        : "—";
export const key = () => crypto.randomUUID();
export async function api(path: string, data?: Row) {
    const res = await fetch(path, {
        method: data ? "POST" : "GET",
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-CSRF-TOKEN":
                document.querySelector<HTMLMetaElement>(
                    'meta[name="csrf-token"]',
                )?.content || "",
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
    });
    if (res.status === 401 || res.status === 419) {
        location.href = "/login";
        throw new Error("Please sign in again.");
    }
    const json = await res.json();
    if (!res.ok)
        throw new Error(
            json.errors
                ? Object.values(json.errors).flat().join(" ")
                : json.message || "Could not save. Please retry.",
        );
    return json;
}
export function Modal({
    title,
    children,
    close,
    wide = false,
}: {
    title: string;
    children: React.ReactNode;
    close: () => void;
    wide?: boolean;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        ref.current?.showModal();
    }, []);
    return (
        <dialog ref={ref} onCancel={close} className={wide ? "modal modal-wide" : "modal"}>
            <div className="modal-head">
                <h2>{title}</h2>
                <button
                    className="icon-button"
                    aria-label="Close dialog"
                    onClick={close}
                >
                    <X size={22} />
                </button>
            </div>
            <div className="modal-body">{children}</div>
        </dialog>
    );
}
export function Field({
    label,
    children,
    className = "",
    group = false,
}: {
    label: string;
    children: React.ReactNode;
    className?: string;
    group?: boolean;
}) {
    const Tag = group ? "div" : "label";
    return (
        <Tag className={`field ${className}`}>
            <span>{label}</span>
            {children}
        </Tag>
    );
}
export function Pill({
    children,
    tone = "",
}: {
    children: React.ReactNode;
    tone?: string;
}) {
    return <span className={"pill " + tone}>{children}</span>;
}
export function Empty({ text = "Nothing here yet." }: { text?: string }) {
    return <div className="empty">{text}</div>;
}
export function Stats({ summary }: { summary: Row }) {
    const money = useMoney();
    return (
        <div className="stats">
            {[
                ["Net sales", summary.net_cents],
                ["Cash collections", summary.cash_cents],
                ["Card collections", summary.card_cents],
                ["Tips earned", summary.earned_tips_cents],
            ].map(([label, value], i) => (
                <div className={"stat stat-" + i} key={String(label)}>
                    <span>{label}</span>
                    <strong>{money(Number(value))}</strong>
                </div>
            ))}
        </div>
    );
}
export type FieldSpec = {
    key: string;
    label: string;
    type?: string;
    required?: boolean;
    options?: { value: any; label: string }[];
    help?: string;
};
export function Editor({
    title,
    fields,
    initial = {},
    close,
    save,
    wide = false,
    submitLabel = "Save",
    description,
    secondaryAction,
    booking = false,
}: {
    title: string;
    fields: FieldSpec[];
    initial?: Row;
    close: () => void;
    save: (v: Row) => Promise<any>;
    wide?: boolean;
    submitLabel?: string;
    description?: string;
    secondaryAction?: { label: string; disabled?: boolean; onClick: () => void };
    booking?: boolean;
}) {
    const [v, set] = useState<Row>(initial);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [choiceSearch, setChoiceSearch] = useState("");
    const [availability, setAvailability] = useState<{ key: string; options: {value: number; label: string}[]; error: string }>({key:"", options:[], error:""});
    const availabilityKey = JSON.stringify([v.starts_at, v.ends_at, v.guests, v.id]);
    useEffect(() => {
        if (!booking) return;
        let active = true;
        let request = 0;
        const load = async () => {
            const current = ++request;
            if (!v.starts_at || !v.ends_at || !v.guests) {
                setAvailability({key:availabilityKey, options:[], error:"Choose start/end times and the number of guests to see available tables."}); return;
            }
            try {
                const params = new URLSearchParams({starts_at:v.starts_at, ends_at:v.ends_at, guests:String(v.guests)});
                if (v.id) params.set("id", String(v.id));
                const result = await api("/api/available-tables?" + params);
                if (!active || current !== request) return;
                const options = result.tables.map((t: Row) => ({value:t.id, label:`${t.name} · ${t.seats} seats · ${t.area}`}));
                setAvailability({key:availabilityKey, options, error:""});
                set(prev => prev.table_id && !options.some((o: {value: number}) => String(o.value) === String(prev.table_id)) ? {...prev, table_id:""} : prev);
            } catch (e) {
                if (active && current === request) setAvailability({key:availabilityKey, options:[], error:(e as Error).message});
            }
        };
        const timer = setTimeout(load, 250);
        const interval = setInterval(load, 5000);
        return () => { active = false; clearTimeout(timer); clearInterval(interval); };
    }, [booking, availabilityKey]);
    const availabilityReady = !booking || (availability.key === availabilityKey && !availability.error);
    const displayFields = booking ? [...fields.filter(f => f.key !== "table_id"), ...fields.filter(f => f.key === "table_id").map(f => ({...f, options: availabilityReady ? availability.options : [], help: availability.key !== availabilityKey ? "Checking availability…" : availability.error || (availability.options.length ? "Only available tables are shown. Availability refreshes automatically." : "No tables available for this time and party size. Try another time.")}))] : fields;
    return (
        <Modal title={title} close={close} wide={wide}>
            {description && <p className="muted mb-4">{description}</p>}
            <form
                onSubmit={async (e) => {
                    e.preventDefault();
                    if (!availabilityReady) return;
                    setBusy(true);
                    setError("");
                    try {
                        await save(v);
                        close();
                    } catch (e) {
                        setError((e as Error).message);
                    } finally {
                        setBusy(false);
                    }
                }}
            >
                <div className={fields.length === 2 && fields.some((f) => f.type === "textarea") ? "form-grid extras-editor-grid" : "form-grid"}>
                    {displayFields.filter((f) => !(v.department === "bar" && f.key === "extra_group_ids")).map((f) => (
                        <Field key={f.key} label={f.label} group={f.type === "multichoice"} className={f.type === "textarea" ? "editor-long-field" : ""}>
                            {f.type === "multichoice" ? (
                                <div>
                                    <input type="search" aria-label="Search extras lists" placeholder="Search extras lists" value={choiceSearch} onChange={(e) => setChoiceSearch(e.target.value)} />
                                    <div className="extras-choices">
                                        {f.options?.filter((o) => o.label.toLowerCase().includes(choiceSearch.toLowerCase())).map((o) => (
                                            <label key={o.value} className="extras-choice"><input type="checkbox" aria-label={o.label} checked={(v[f.key] || []).includes(o.value)} onChange={(e) => set({ ...v, [f.key]: e.target.checked ? [...(v[f.key] || []), o.value] : (v[f.key] || []).filter((id: number) => id !== o.value) })} /><span>{o.label}</span></label>
                                        ))}
                                    </div>
                                    <small>{(v[f.key] || []).length} lists selected</small>
                                </div>
                            ) : f.type === "photo" ? (
                                <div>
                                    {v[f.key] && (
                                        <img
                                            src={v[f.key]}
                                            alt="Product preview"
                                            className="photo-preview"
                                        />
                                    )}
                                    <input
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp"
                                        onChange={async (e) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;
                                            try {
                                                if (file.size > 8 * 1024 * 1024)
                                                    throw new Error(
                                                        "Choose a photo under 8 MB.",
                                                    );
                                                const bitmap =
                                                    await createImageBitmap(
                                                        file,
                                                    );
                                                const canvas =
                                                    document.createElement(
                                                        "canvas",
                                                    );
                                                const scale = Math.min(
                                                    1,
                                                    400 /
                                                        Math.max(
                                                            bitmap.width,
                                                            bitmap.height,
                                                        ),
                                                );
                                                canvas.width = Math.round(
                                                    bitmap.width * scale,
                                                );
                                                canvas.height = Math.round(
                                                    bitmap.height * scale,
                                                );
                                                canvas
                                                    .getContext("2d")!
                                                    .drawImage(
                                                        bitmap,
                                                        0,
                                                        0,
                                                        canvas.width,
                                                        canvas.height,
                                                    );
                                                bitmap.close();
                                                const photo = canvas.toDataURL(
                                                    "image/jpeg",
                                                    0.8,
                                                );
                                                if (photo.length > 220000)
                                                    throw new Error(
                                                        "Please choose a smaller photo.",
                                                    );
                                                set((prev) => ({
                                                    ...prev,
                                                    [f.key]: photo,
                                                }));
                                                setError("");
                                            } catch (err) {
                                                setError(
                                                    (err as Error).message,
                                                );
                                            }
                                        }}
                                    />
                                    <button
                                        type="button"
                                        className="secondary photo-remove"
                                        onClick={() =>
                                            set({ ...v, [f.key]: null })
                                        }
                                    >
                                        Remove photo
                                    </button>
                                </div>
                            ) : f.type === "checkbox" ? (
                                <input
                                    type="checkbox"
                                    checked={!!v[f.key]}
                                    onChange={(e) =>
                                        set({ ...v, [f.key]: e.target.checked })
                                    }
                                />
                            ) : f.options ? (
                                <select
                                    required={f.required}
                                    value={v[f.key] ?? ""}
                                    onChange={(e) =>
                                        set({ ...v, [f.key]: e.target.value })
                                    }
                                >
                                    <option value="">Select</option>
                                    {f.options.map((o) => (
                                        <option key={o.value} value={o.value}>
                                            {o.label}
                                        </option>
                                    ))}
                                </select>
                            ) : f.type === "textarea" ? (
                                <textarea
                                    value={v[f.key] ?? ""}
                                    onChange={(e) =>
                                        set({ ...v, [f.key]: e.target.value })
                                    }
                                />
                            ) : (
                                <input
                                    required={f.required}
                                    type={f.type || "text"}
                                    min={f.type === "number" ? 0 : undefined}
                                    step={
                                        f.type === "number" ? "0.01" : undefined
                                    }
                                    value={v[f.key] ?? ""}
                                    onChange={(e) =>
                                        set({ ...v, [f.key]: e.target.value })
                                    }
                                />
                            )}{" "}
                            {f.help && <small>{f.help}</small>}
                        </Field>
                    ))}
                </div>
                {error && (
                    <p className="error" role="alert">
                        {error}
                    </p>
                )}
                <div className="modal-actions">
                    {secondaryAction && <button type="button" className="secondary danger-text mr-auto" disabled={busy || secondaryAction.disabled} onClick={secondaryAction.onClick}>{secondaryAction.label}</button>}
                    <button type="button" className="secondary" onClick={close}>
                        Cancel
                    </button>
                    <button disabled={busy || !availabilityReady || (booking && !v.table_id)} className="primary">
                        {busy ? (
                            <LoaderCircle className="spin" size={18} />
                        ) : (
                            submitLabel
                        )}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
