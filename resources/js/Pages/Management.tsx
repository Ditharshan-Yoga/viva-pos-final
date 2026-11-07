import Transactions from "./Transactions";
import React, { useState } from "react";
import {
    Plus,
    Users,
    Clock,
    ReceiptText,
    ArrowUpRight,
    Search,
    Pencil,
    CircleCheck,
} from "lucide-react";
import {
    Row,
    FieldSpec,
    useMoney,
    timestamp,
    Stats,
    Pill,
    Empty,
    Editor,
    Field,
    Modal,
} from "./ui";
type Props = {
    view: string;
    data: Row;
    act: (a: string, v?: Row) => Promise<any>;
    busy: boolean;
    openOrder: (id: number) => void;
    seat: (r: Row) => Promise<any>;
    refund: (o: Row) => void;
};
export default function Management({
    view,
    data,
    act,
    busy,
    openOrder,
    seat,
    refund,
}: Props) {
    const money = useMoney();
    const [extrasQuery, setExtrasQuery] = useState("");
    const [extrasPage, setExtrasPage] = useState(0);
    const filteredExtras = data.extra_groups.filter((g: Row) =>
        [g.name, ...g.modifiers.map((m: Row) => m.name)].some((name: string) =>
            name.toLowerCase().includes(extrasQuery.trim().toLowerCase()),
        ),
    );
    const extrasPages = Math.max(1, Math.ceil(filteredExtras.length / 5));
    const currentExtrasPage = Math.min(extrasPage, extrasPages - 1);
    const [edit, E] = useState<Row | null>(null),
        [tab, T] = useState("menu"),
        [query, Q] = useState(""),
        [status, S] = useState("all");
    const manager = ["manager", "admin"].includes(data.user.role),
        tz = data.settings.timezone,
        userName = (id: number) =>
            data.employees.find((u: Row) => u.id === id)?.name || "Kitchen";
    const safe = async (a: string, v: Row = {}) => {
        try {
            await act(a, v);
        } catch {}
    };
    const openEditor = (
        title: string,
        action: string,
        fields: FieldSpec[],
        initial: Row = {},
    ) => E({ title, action, fields, initial });
    const employeeFields: FieldSpec[] = [
        { key: "name", label: "Full name", required: true },
        { key: "employee_id", label: "Employee ID", required: true },
        {
            key: "role",
            label: "Role",
            required: true,
            options:
                data.user.role === "manager"
                    ? [
                          { value: "admin", label: "Admin" },
                          { value: "cashier", label: "Cashier" },
                      ]
                    : [{ value: "cashier", label: "Cashier" }],
        },
        {
            key: "pin",
            label: "PIN · leave blank to keep existing",
            type: "password",
        },
        { key: "active", label: "Account enabled", type: "checkbox" },
    ];
    const productFields: FieldSpec[] = [
        { key: "name", label: "Product name", required: true },
        {
            key: "category_id",
            label: "Category",
            required: true,
            options: data.categories.map((c: Row) => ({
                value: c.id,
                label: c.name,
            })),
        },
        {
            key: "department",
            label: "Department",
            required: true,
            options: [
                { value: "restaurant", label: "Restaurant" },
                { value: "bar", label: "Bar" },
            ],
        },
        { key: "price", label: "Base price", type: "number", required: true },
        {
            key: "takeout_price",
            label: "Takeaway price · optional",
            type: "number",
            help: "Blank uses the base price. Variants keep their own prices.",
        },
        { key: "photo", label: "Product photo · optional", type: "photo" },
        {
            key: "extra_group_ids",
            label: "Shared extras · optional",
            type: "multichoice",
            options: data.extra_groups.map((g: Row) => ({
                value: g.id,
                label: g.name,
            })),
        },
        { key: "kitchen", label: "Send to kitchen", type: "checkbox" },
        { key: "active", label: "Available", type: "checkbox" },
        {
            key: "variant_text",
            label: "Variants · one name and price per line",
            type: "textarea",
            help: "Example: Regular | 14.90",
        },
    ];
    const promotionFields: FieldSpec[] = [
        { key: "name", label: "Offer name", required: true },
        { key: "code", label: "Promo code · blank for a selectable discount" },
        {
            key: "type",
            label: "Type",
            required: true,
            options: [
                { value: "percent", label: "Percentage" },
                { value: "fixed", label: "Fixed amount" },
            ],
        },
        {
            key: "value",
            label: "Value · percent or dollars",
            type: "number",
            required: true,
        },
        { key: "starts_at", label: "Valid from", type: "datetime-local" },
        { key: "ends_at", label: "Valid until", type: "datetime-local" },
        { key: "usage_limit", label: "Maximum uses", type: "number" },
        { key: "active", label: "Active", type: "checkbox" },
    ];
    const bookingFields: FieldSpec[] = [
        { key: "name", label: "Customer name", required: true },
        { key: "phone", label: "Phone" },
        {
            key: "table_id",
            label: "Table",
            required: true,
            options: data.tables
                .filter((t: Row) => t.active)
                .map((t: Row) => ({
                    value: t.id,
                    label: `${t.name} · ${t.seats} seats`,
                })),
        },
        { key: "guests", label: "Guests", type: "number", required: true },
        {
            key: "starts_at",
            label: "Start · restaurant time",
            type: "datetime-local",
            required: true,
        },
        {
            key: "ends_at",
            label: "End · restaurant time",
            type: "datetime-local",
            required: true,
        },
        { key: "notes", label: "Notes" },
    ];
    const terminalFields: FieldSpec[] = [
        { key: "name", label: "Terminal name", required: true },
        { key: "identifier", label: "Internal identifier", required: true },
        { key: "provider", label: "Provider" },
        { key: "provider_id", label: "Provider terminal ID" },
        { key: "location", label: "Location" },
        { key: "notes", label: "Notes" },
        { key: "active", label: "Active", type: "checkbox" },
    ];
    const saveEditor = async (v: Row) => {
        let payload = { ...v };
        for (const f of edit!.fields) {
            if (f.type === "number" && payload[f.key] === "")
                payload[f.key] = null;
        }
        if (["product.save", "extras.save"].includes(edit!.action)) {
            const currency = data.settings.currency || "CAD";
            const symbol = new Intl.NumberFormat("en-CA", { style: "currency", currency })
                .formatToParts(0).find((part) => part.type === "currency")?.value || currency;
            const prefixes = [currency, symbol, "$"].sort((a, b) => b.length - a.length);
            const parse = (s: string) =>
                s.trim()
                    ? s
                          .split("\n")
                          .filter((line) => line.trim())
                          .map((line) => {
                              const parts = line
                                  .split("|")
                                  .map((s) => s.trim());
                              const [name, enteredPrice] = parts;
                              const prefix = prefixes.find((value) => enteredPrice?.startsWith(value));
                              const price = (prefix ? enteredPrice.slice(prefix.length) : enteredPrice || "").trim();
                              if (
                                  parts.length !== 2 ||
                                  !name ||
                                  !/^\d+(\.\d{1,2})?$/.test(price || "")
                              )
                                  throw new Error(
                                      "Enter one item per line, for example: Cheddar Cheese | 6.00. Use a positive price or zero, with at most two decimal places.",
                                  );
                              return {
                                  name,
                                  price_cents: Math.round(Number(price) * 100),
                              };
                          })
                    : [];
            if (edit!.action === "product.save")
                payload.variants = parse(payload.variant_text || "");
            if (edit!.action === "extras.save" || payload.modifier_text !== undefined)
                payload.modifiers = parse(payload.modifier_text || "");
        }
        await act(edit!.action, payload);
    };
    const rowList = (rows: Row[], render: (r: Row) => React.ReactNode) => (
        <div className="record-list">
            {rows.length ? rows.map(render) : <Empty />}
        </div>
    );
    return (
        <>
            {view === "overview" && (
                <section>
                    <div className="section-heading">
                        <div>
                            <h2>The day at a glance</h2>
                            <p className="muted">
                                Business day{" "}
                                {data.day?.business_date || "not started"} · {data.settings.currency || "CAD"}
                            </p>
                        </div>
                        <Pill>{data.summary.orders} paid orders</Pill>
                    </div>
                    <Stats summary={data.summary} />
                    <div className="dashboard-grid">
                        <article className="panel">
                            <h2>Sales breakdown</h2>
                            {[
                                ["Gross sales", data.summary.gross_cents],
                                ["Discounts", data.summary.discount_cents],
                                [
                                    "Refunds including tips",
                                    data.summary.refund_cents,
                                ],
                                ["Net tax", data.summary.tax_cents],
                                ["Net tips collected", data.summary.tips_cents],
                            ].map(([label, value]) => (
                                <div
                                    className="metric-line"
                                    key={String(label)}
                                >
                                    <span>{label}</span>
                                    <strong>{money(Number(value))}</strong>
                                </div>
                            ))}
                            <p className="muted">
                                Net sales excludes taxes and tips. Cash and card
                                show collections less refunds.
                            </p>
                        </article>
                        <article className="panel">
                            <h2>Service mix</h2>
                            <div className="service-mix">
                                <div>
                                    <strong>{data.summary.dine_in}</strong>
                                    <span>Dine-in orders</span>
                                </div>
                                <div>
                                    <strong>{data.summary.takeout}</strong>
                                    <span>Takeout orders</span>
                                </div>
                                <div>
                                    <strong>{data.summary.delivery || 0}</strong>
                                    <span>Delivery orders</span>
                                </div>
                            </div>
                            <h3>Cashier performance</h3>
                            {data.cashier_reports?.map((r: Row) => (
                                <div className="metric-line" key={r.id}>
                                    <span>{r.name}</span>
                                    <strong>
                                        {money(r.summary.net_cents)}
                                    </strong>
                                    <span>
                                        {money(r.summary.earned_tips_cents)}{" "}
                                        tips
                                    </span>
                                </div>
                            ))}
                        </article>
                        <article className="panel">
                            <h2>Product sales</h2>
                            {rowList(
                                Object.values(
                                    data.orders
                                        .filter(
                                            (o: Row) =>
                                                o.business_day_id ===
                                                    data.day?.id &&
                                                o.status === "paid",
                                        )
                                        .flatMap((o: Row) => o.items)
                                        .reduce((acc: Row, i: Row) => {
                                            acc[i.name] ??= {
                                                name: i.name,
                                                quantity: 0,
                                                amount: 0,
                                            };
                                            acc[i.name].quantity += i.quantity;
                                            acc[i.name].amount +=
                                                i.quantity * i.unit_cents;
                                            return acc;
                                        }, {}),
                                ) as Row[],
                                (p) => (
                                    <div className="metric-line" key={p.name}>
                                        <span>
                                            {p.name} × {p.quantity}
                                        </span>
                                        <strong>{money(p.amount)}</strong>
                                    </div>
                                ),
                            )}
                        </article>
                        <article className="panel">
                            <h2>Discount usage</h2>
                            {data.promotions?.map((p: Row) => (
                                <div className="metric-line" key={p.id}>
                                    <span>{p.name}</span>
                                    <strong>{p.uses} uses</strong>
                                </div>
                            ))}
                            <h3>Reservations</h3>
                            {[
                                "upcoming",
                                "seated",
                                "completed",
                                "cancelled",
                                "no_show",
                            ].map((s) => (
                                <div className="metric-line" key={s}>
                                    <span>{s.replace("_", " ")}</span>
                                    <strong>
                                        {
                                            data.reservations.filter(
                                                (r: Row) => r.status === s,
                                            ).length
                                        }
                                    </strong>
                                </div>
                            ))}
                        </article>
                    </div>
                    <DayPanel
                        data={data}
                        act={act}
                        busy={busy}
                        openEditor={openEditor}
                    />
                </section>
            )}
            {view === "profile" && (
                <section>
                    <div className="section-heading">
                        <div>
                            <span className="eyebrow">YOUR DAILY ACTIVITY</span>
                            <h2>{data.user.name}</h2>
                            <p className="muted">
                                {data.user.employee_id} · {data.user.role}
                            </p>
                        </div>
                    </div>
                    <Stats summary={data.my_summary} />
                    <article className="panel">
                        <h2>Close my daily activity</h2>
                        <p className="muted">
                            Review your recorded payments, tips and refunds,
                            then submit your summary. Manager or Admin closes
                            the restaurant day.
                        </p>
                        <div className="metric-line">
                            <span>Payments processed</span>
                            <strong>{data.my_summary.orders}</strong>
                        </div>
                        <div className="metric-line">
                            <span>Refunds processed</span>
                            <strong>
                                {money(data.my_summary.refund_cents)}
                            </strong>
                        </div>
                        <button
                            className="primary"
                            disabled={busy || data.day?.status !== "open"}
                            onClick={() => safe("day.submit")}
                        >
                            Submit my daily summary
                        </button>
                        {data.daily_summaries.some(
                            (s: Row) => s.user_id === data.user.id,
                        ) && (
                            <p className="success">
                                Your summary has been submitted. Submit again
                                after any further activity.
                            </p>
                        )}
                    </article>
                </section>
            )}
            {view === "reservations" && (
                <section>
                    <div className="section-heading">
                        <div>
                            <h2>Save them a seat</h2>
                            <p className="muted">
                                Bookings block the selected table only during
                                the booked period.
                            </p>
                        </div>
                        <button
                            className="primary"
                            onClick={() =>
                                openEditor(
                                    "New reservation",
                                    "reservation.create",
                                    [
                                        {
                                            key: "name",
                                            label: "Customer name",
                                            required: true,
                                        },
                                        { key: "phone", label: "Phone" },
                                        {
                                            key: "table_id",
                                            label: "Table",
                                            required: true,
                                            options: data.tables
                                                .filter((t: Row) => t.active)
                                                .map((t: Row) => ({
                                                    value: t.id,
                                                    label: `${t.name} · ${t.seats} seats`,
                                                })),
                                        },
                                        {
                                            key: "guests",
                                            label: "Guests",
                                            type: "number",
                                            required: true,
                                        },
                                        {
                                            key: "starts_at",
                                            label: "Start · restaurant time",
                                            type: "datetime-local",
                                            required: true,
                                        },
                                        {
                                            key: "ends_at",
                                            label: "End · restaurant time",
                                            type: "datetime-local",
                                            required: true,
                                        },
                                        { key: "notes", label: "Notes" },
                                    ],
                                    {
                                        guests: 2,
                                        ...bookingDefaults(
                                            data.settings.booking_minutes,
                                            tz,
                                        ),
                                    },
                                )
                            }
                        >
                            <Plus size={18} />
                            New booking
                        </button>
                    </div>
                    <div className="booking-grid">
                        {data.reservations.map((r: Row) => (
                            <article className="panel booking" key={r.id}>
                                <div className="section-heading">
                                    <div className="avatar">{r.name[0]}</div>
                                    <Pill
                                        tone={
                                            r.status === "upcoming"
                                                ? "warm"
                                                : "neutral"
                                        }
                                    >
                                        {r.status.replace("_", " ")}
                                    </Pill>
                                </div>
                                <h2>{r.name}</h2>
                                <p className="muted">
                                    {r.phone || "No phone"} · {r.guests} guests
                                </p>
                                <div className="booking-time">
                                    <strong>
                                        {
                                            data.tables.find(
                                                (t: Row) =>
                                                    t.id === r.dining_table_id,
                                            )?.name
                                        }
                                    </strong>
                                    <span>{timestamp(r.starts_at, tz)}</span>
                                    <span>
                                        Until {timestamp(r.ends_at, tz)}
                                    </span>
                                </div>
                                {r.notes && <p>{r.notes}</p>}
                                {r.status === "upcoming" && (
                                    <div className="button-row">
                                        <button
                                            className="primary"
                                            disabled={
                                                data.day?.status !== "open" ||
                                                busy
                                            }
                                            onClick={() =>
                                                seat(r).catch(() => {})
                                            }
                                        >
                                            Seat customer
                                        </button>
                                        <button
                                            className="secondary"
                                            onClick={() =>
                                                openEditor(
                                                    "Edit reservation",
                                                    "reservation.update",
                                                    bookingFields,
                                                    {
                                                        ...r,
                                                        table_id:
                                                            r.dining_table_id,
                                                        starts_at: localInput(
                                                            r.starts_at,
                                                            tz,
                                                        ),
                                                        ends_at: localInput(
                                                            r.ends_at,
                                                            tz,
                                                        ),
                                                    },
                                                )
                                            }
                                        >
                                            Edit
                                        </button>
                                        <button
                                            className="secondary"
                                            onClick={() =>
                                                safe("reservation.status", {
                                                    id: r.id,
                                                    status: "no_show",
                                                })
                                            }
                                        >
                                            No-show
                                        </button>
                                        <button
                                            className="text-button danger-text"
                                            onClick={() =>
                                                openEditor(
                                                    "Cancel booking",
                                                    "reservation.status",
                                                    [],
                                                    {
                                                        id: r.id,
                                                        status: "cancelled",
                                                    },
                                                )
                                            }
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                )}
                            </article>
                        ))}
                    </div>
                    {!data.reservations.length && (
                        <Empty text="No reservations yet. Add the first booking." />
                    )}
                </section>
            )}
            {view === "transactions" && (
                <Transactions
                    data={data}
                    openOrder={openOrder}
                    refund={refund}
                />
            )}
            {view === "team" && manager && (
                <section>
                    <div className="section-heading">
                        <div>
                            <h2>Your team, in view</h2>
                            <p className="muted">
                                Session activity is shown in {tz}.
                            </p>
                        </div>
                        <button
                            className="primary"
                            onClick={() =>
                                openEditor(
                                    "Add employee",
                                    "user.save",
                                    employeeFields,
                                    { role: "cashier", active: true },
                                )
                            }
                        >
                            <Plus size={18} />
                            Add employee
                        </button>
                    </div>
                    <div className="employee-grid">
                        {data.employees.map((u: Row) => {
                            const sessions = data.sessions.filter(
                                    (s: Row) => s.user_id === u.id,
                                ),
                                latest = sessions[0],
                                online = sessions.some((s: Row) => s.online);
                            return (
                                <article
                                    className="panel employee-profile"
                                    key={u.id}
                                >
                                    <div className="section-heading">
                                        <div className="avatar">
                                            {u.name[0]}
                                        </div>
                                        <Pill
                                            tone={online ? "good" : "neutral"}
                                        >
                                            {online ? "Active now" : "Inactive"}
                                        </Pill>
                                    </div>
                                    <h3>{u.name}</h3>
                                    <p className="muted">
                                        {u.role} · {u.employee_id}
                                    </p>
                                    <small>Last login</small>
                                    <p>{timestamp(latest?.started_at, tz)}</p>
                                    <small>Last seen</small>
                                    <p>{timestamp(latest?.last_seen_at, tz)}</p>
                                    <Pill>
                                        {u.active
                                            ? "Account enabled"
                                            : "Account disabled"}
                                    </Pill>
                                    {u.role !== "manager" &&
                                        (data.user.role === "manager" ||
                                            u.role === "cashier") && (
                                            <button
                                                className="secondary full"
                                                onClick={() =>
                                                    openEditor(
                                                        "Edit employee",
                                                        "user.save",
                                                        employeeFields,
                                                        u,
                                                    )
                                                }
                                            >
                                                Edit employee
                                            </button>
                                        )}
                                </article>
                            );
                        })}
                    </div>
                    <h2 className="section-title">Session history</h2>
                    <div className="table-scroll">
                        <table>
                            <thead>
                                <tr>
                                    <th>Employee</th>
                                    <th>Started</th>
                                    <th>Last seen</th>
                                    <th>Ended or inactivity detected</th>
                                    <th>Reason</th>
                                    <th>Device</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.sessions.map((s: Row) => (
                                    <tr key={s.id}>
                                        <td>{userName(s.user_id)}</td>
                                        <td>{timestamp(s.started_at, tz)}</td>
                                        <td>{timestamp(s.last_seen_at, tz)}</td>
                                        <td>
                                            {timestamp(
                                                s.ended_at ||
                                                    s.inactive_detected_at,
                                                tz,
                                            )}
                                        </td>
                                        <td>
                                            {s.end_reason ||
                                                (s.online
                                                    ? "Active"
                                                    : "Connection inactive")}
                                        </td>
                                        <td>{s.device}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}
            {view === "settings" && manager && (
                <section>
                    <div className="tabs">
                        {[
                            "menu",
                            "tables",
                            "offers",
                            "terminals",
                            "business",
                            "audit",
                        ].map((t) => (
                            <button
                                className={tab === t ? "selected" : ""}
                                key={t}
                                onClick={() => T(t)}
                            >
                                {t}
                            </button>
                        ))}
                    </div>
                    {tab === "menu" && (
                        <>
                            <div className="section-heading">
                                <h2>Menu management</h2>
                                <div className="button-row">
                                    <button
                                        className="secondary"
                                        onClick={() =>
                                            openEditor(
                                                "New category",
                                                "category.save",
                                                [
                                                    {
                                                        key: "name",
                                                        label: "Category name",
                                                        required: true,
                                                    },
                                                ],
                                            )
                                        }
                                    >
                                        Add category
                                    </button>
                                    <button
                                        className="primary"
                                        onClick={() =>
                                            openEditor(
                                                "Add product",
                                                "product.save",
                                                productFields,
                                                {
                                                    active: true,
                                                    kitchen: true,
                                                    department: "restaurant",
                                                    price: "0",
                                                    category_id:
                                                        data.categories[0]?.id,
                                                },
                                            )
                                        }
                                    >
                                        <Plus size={18} />
                                        Add product
                                    </button>
                                </div>
                            </div>
                            <details className="panel mb-6">
                                <summary>Shared extras</summary>
                                <p className="muted">
                                    Create an extras list once, then choose it
                                    on any product. Changes apply to future
                                    items only.
                                </p>
                                <button
                                    className="primary"
                                    onClick={() =>
                                        openEditor(
                                            "New shared extras",
                                            "extras.save",
                                            [
                                                {
                                                    key: "name",
                                                    label: "List name",
                                                    required: true,
                                                },
                                                {
                                                    key: "modifier_text",
                                                    label: "Extras · Name | Price",
                                                    help: "One extra per line, e.g. Cheddar Cheese | 6.00",
                                                    type: "textarea",
                                                    required: true,
                                                },
                                            ],
                                        )
                                    }
                                >
                                    <Plus size={16} /> New extras list
                                </button>
                                <div className="extras-search">
                                    <input aria-label="Search shared extras" placeholder="Search list or extra name…" value={extrasQuery} onChange={(e) => { setExtrasQuery(e.target.value); setExtrasPage(0); }} />
                                    {extrasQuery && <button className="secondary" onClick={() => { setExtrasQuery(""); setExtrasPage(0); }}>Clear</button>}
                                </div>
                                <div className="extras-compact-list">
                                {filteredExtras.slice(currentExtrasPage * 5, currentExtrasPage * 5 + 5).map((g: Row) => (
                                    <div className="extras-compact-row" key={g.id}>
                                        <div className="extras-row-name"><strong>{g.name}</strong><small>{g.modifiers.length} extras · {data.products.filter((p: Row) => (p.extra_group_ids || []).includes(g.id)).length} products</small></div>
                                    <button
                                        className="secondary"
                                        aria-label={`Edit ${g.name}`}
                                        onClick={() =>
                                            openEditor(
                                                "Edit shared extras",
                                                "extras.save",
                                                [
                                                    {
                                                        key: "name",
                                                        label: "List name",
                                                        required: true,
                                                    },
                                                    {
                                                        key: "modifier_text",
                                                        label: "Extras · Name | Price",
                                                        help: "One extra per line, e.g. Cheddar Cheese | 6.00",
                                                        type: "textarea",
                                                        required: true,
                                                    },
                                                ],
                                                {
                                                    ...g,
                                                    modifier_text: g.modifiers
                                                        .map(
                                                            (m: Row) =>
                                                                `${m.name} | ${(m.price_cents / 100).toFixed(2)}`,
                                                        )
                                                        .join("\n"),
                                                },
                                            )
                                        }
                                    >
                                        <Pencil size={16} /> Edit
                                    </button>
                                    </div>
                                ))}
                                </div>
                                {filteredExtras.length === 0 && data.extra_groups.length > 0 && <p className="muted">No matching extras lists.</p>}
                                {filteredExtras.length > 0 && <div className="extras-pagination">
                                    <span aria-live="polite">{currentExtrasPage * 5 + 1}–{Math.min((currentExtrasPage + 1) * 5, filteredExtras.length)} of {filteredExtras.length} lists</span>
                                    <button className="secondary" disabled={currentExtrasPage === 0} onClick={() => setExtrasPage(currentExtrasPage - 1)}>Previous</button>
                                    <button className="secondary" disabled={currentExtrasPage + 1 >= extrasPages} onClick={() => setExtrasPage(currentExtrasPage + 1)}>Next</button>
                                </div>}
                                {data.extra_groups.length === 0 && <p className="muted mt-4">No shared extras yet. Create your first list above.</p>}
                            </details>
                            {rowList(data.products, (p) => (
                                <div className="record" key={p.id}>
                                    <div className="record-icon">
                                        {p.name[0]}
                                    </div>
                                    <div>
                                        <strong>{p.name}</strong>
                                        <small>
                                            {
                                                data.categories.find(
                                                    (c: Row) =>
                                                        c.id === p.category_id,
                                                )?.name
                                            }{" "}
                                            ·{" "}
                                            {p.department === "bar"
                                                ? "Bar"
                                                : "Restaurant"}{" "}
                                            · {p.kitchen ? "Kitchen" : "No KOT"}
                                        </small>
                                    </div>
                                    <strong>{money(p.price_cents)}</strong>
                                    <Pill tone={p.active ? "good" : "neutral"}>
                                        {p.active ? "Available" : "Unavailable"}
                                    </Pill>
                                    <button
                                        className="icon-button"
                                        aria-label={"Edit " + p.name}
                                        onClick={() =>
                                            openEditor(
                                                "Edit product",
                                                "product.save",
                                                productFields,
                                                {
                                                    ...p,
                                                    takeout_price:
                                                        p.takeout_price_cents ==
                                                        null
                                                            ? ""
                                                            : (
                                                                  p.takeout_price_cents /
                                                                  100
                                                              ).toFixed(2),
                                                    price: (
                                                        p.price_cents / 100
                                                    ).toFixed(2),
                                                    variant_text: p.variants
                                                        ?.map(
                                                            (v: Row) =>
                                                                `${v.name} | ${(v.price_cents / 100).toFixed(2)}`,
                                                        )
                                                        .join("\n"),
                                                    modifier_text:
                                                        p.own_modifiers
                                                            ?.map(
                                                                (v: Row) =>
                                                                    `${v.name} | ${(v.price_cents / 100).toFixed(2)}`,
                                                            )
                                                            .join("\n"),
                                                },
                                            )
                                        }
                                    >
                                        <Pencil size={18} />
                                    </button>
                                </div>
                            ))}
                        </>
                    )}
                    {tab === "tables" && (
                        <>
                            <div className="section-heading">
                                <h2>Dining tables</h2>
                                <button
                                    className="primary"
                                    onClick={() =>
                                        openEditor(
                                            "Add table",
                                            "table.save",
                                            [
                                                {
                                                    key: "name",
                                                    label: "Table name",
                                                    required: true,
                                                },
                                                {
                                                    key: "area",
                                                    label: "Area · e.g. Restaurant, Bar, Patio",
                                                    required: true,
                                                },
                                                {
                                                    key: "department",
                                                    label: "Department",
                                                    required: true,
                                                    options: [
                                                        {
                                                            value: "restaurant",
                                                            label: "Restaurant",
                                                        },
                                                        {
                                                            value: "bar",
                                                            label: "Bar",
                                                        },
                                                    ],
                                                },
                                                {
                                                    key: "seats",
                                                    label: "Seats",
                                                    type: "number",
                                                    required: true,
                                                },
                                                {
                                                    key: "active",
                                                    label: "Active",
                                                    type: "checkbox",
                                                },
                                            ],
                                            {
                                                seats: 4,
                                                active: true,
                                                area: "Restaurant",
                                                department: "restaurant",
                                            },
                                        )
                                    }
                                >
                                    Add table
                                </button>
                            </div>
                            {rowList(data.tables, (t) => (
                                <div className="record" key={t.id}>
                                    <strong>{t.name}</strong>
                                    <span>
                                        {t.area} · {t.seats} seats
                                    </span>
                                    <Pill>
                                        {t.active ? "Active" : "Inactive"}
                                    </Pill>
                                    <button
                                        className="secondary"
                                        onClick={() =>
                                            openEditor(
                                                "Edit table",
                                                "table.save",
                                                [
                                                    {
                                                        key: "name",
                                                        label: "Table name",
                                                        required: true,
                                                    },
                                                    {
                                                        key: "area",
                                                        label: "Area · e.g. Restaurant, Bar, Patio",
                                                        required: true,
                                                    },
                                                    {
                                                        key: "department",
                                                        label: "Department",
                                                        required: true,
                                                        options: [
                                                            {
                                                                value: "restaurant",
                                                                label: "Restaurant",
                                                            },
                                                            {
                                                                value: "bar",
                                                                label: "Bar",
                                                            },
                                                        ],
                                                    },
                                                    {
                                                        key: "seats",
                                                        label: "Seats",
                                                        type: "number",
                                                        required: true,
                                                    },
                                                    {
                                                        key: "active",
                                                        label: "Active",
                                                        type: "checkbox",
                                                    },
                                                ],
                                                t,
                                            )
                                        }
                                    >
                                        Edit
                                    </button>
                                </div>
                            ))}
                        </>
                    )}
                    {tab === "offers" && (
                        <>
                            <div className="section-heading">
                                <h2>Discounts & promo codes</h2>
                                <button
                                    className="primary"
                                    onClick={() =>
                                        openEditor(
                                            "New offer",
                                            "promotion.save",
                                            promotionFields,
                                            {
                                                active: true,
                                                type: "percent",
                                                value: 10,
                                            },
                                        )
                                    }
                                >
                                    Add offer
                                </button>
                            </div>
                            {rowList(data.promotions, (p) => (
                                <div className="record" key={p.id}>
                                    <div>
                                        <strong>{p.name}</strong>
                                        <small>
                                            {p.code || "Predefined discount"} ·{" "}
                                            {p.uses} uses
                                        </small>
                                    </div>
                                    <strong>
                                        {p.type === "percent"
                                            ? p.value / 100 + "%"
                                            : money(p.value)}
                                    </strong>
                                    <Pill>
                                        {p.active ? "Active" : "Inactive"}
                                    </Pill>
                                    <button
                                        className="secondary"
                                        onClick={() =>
                                            openEditor(
                                                "Edit offer",
                                                "promotion.save",
                                                promotionFields,
                                                {
                                                    ...p,
                                                    value: p.value / 100,
                                                    starts_at: localInput(
                                                        p.starts_at,
                                                        tz,
                                                    ),
                                                    ends_at: localInput(
                                                        p.ends_at,
                                                        tz,
                                                    ),
                                                },
                                            )
                                        }
                                    >
                                        Edit
                                    </button>
                                </div>
                            ))}
                        </>
                    )}
                    {tab === "terminals" && (
                        <>
                            <div className="section-heading">
                                <h2>Terminals & reconciliation</h2>
                                <button
                                    className="primary"
                                    onClick={() =>
                                        openEditor(
                                            "Add terminal",
                                            "terminal.save",
                                            terminalFields,
                                            { active: true },
                                        )
                                    }
                                >
                                    Add terminal
                                </button>
                            </div>
                            {rowList(data.terminals, (t) => {
                                const expected =
                                        data.terminal_totals.find(
                                            (v: Row) => v.id === t.id,
                                        )?.expected_cents || 0,
                                    rec = data.reconciliations.find(
                                        (r: Row) => r.terminal_id === t.id,
                                    );
                                return (
                                    <article className="panel" key={t.id}>
                                        <div className="section-heading">
                                            <div>
                                                <h3>{t.name}</h3>
                                                <p className="muted">
                                                    {t.identifier} ·{" "}
                                                    {t.provider ||
                                                        "External terminal"}
                                                </p>
                                            </div>
                                            <button
                                                className="secondary"
                                                onClick={() =>
                                                    openEditor(
                                                        "Edit terminal",
                                                        "terminal.save",
                                                        terminalFields,
                                                        t,
                                                    )
                                                }
                                            >
                                                Edit
                                            </button>
                                        </div>
                                        <div className="reconcile-grid">
                                            <div>
                                                <span>POS expected</span>
                                                <strong>
                                                    {money(expected)}
                                                </strong>
                                            </div>
                                            <div>
                                                <span>Terminal actual</span>
                                                <strong>
                                                    {rec
                                                        ? money(
                                                              rec.actual_cents,
                                                          )
                                                        : "Not entered"}
                                                </strong>
                                            </div>
                                            <div>
                                                <span>Difference</span>
                                                <strong>
                                                    {rec
                                                        ? money(
                                                              rec.actual_cents -
                                                                  expected,
                                                          )
                                                        : "—"}
                                                </strong>
                                            </div>
                                        </div>
                                        <button
                                            className="primary"
                                            disabled={
                                                data.day?.status !== "open"
                                            }
                                            onClick={() =>
                                                openEditor(
                                                    "Record terminal total",
                                                    "reconciliation.save",
                                                    [
                                                        {
                                                            key: "actual",
                                                            label: "Terminal net total including tips and refunds",
                                                            type: "text",
                                                            required: true,
                                                        },
                                                        {
                                                            key: "notes",
                                                            label: "Notes",
                                                        },
                                                    ],
                                                    {
                                                        terminal_id: t.id,
                                                        actual: rec
                                                            ? (
                                                                  rec.actual_cents /
                                                                  100
                                                              ).toFixed(2)
                                                            : "",
                                                    },
                                                )
                                            }
                                        >
                                            Reconcile
                                        </button>
                                    </article>
                                );
                            })}
                        </>
                    )}
                    {tab === "business" && (
                        <BusinessSettings data={data} act={act} />
                    )}
                    {tab === "audit" && (
                        <>
                            <h2>Audit history</h2>
                            <p className="muted">
                                Read-only · latest 150 events
                            </p>
                            <div className="table-scroll">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Date</th>
                                            <th>Employee</th>
                                            <th>Action</th>
                                            <th>Record</th>
                                            <th>Details</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.audit.map((a: Row) => (
                                            <tr key={a.id}>
                                                <td>
                                                    {timestamp(
                                                        a.created_at,
                                                        tz,
                                                    )}
                                                </td>
                                                <td>{a.actor}</td>
                                                <td>
                                                    {a.action.replaceAll(
                                                        ".",
                                                        " ",
                                                    )}
                                                </td>
                                                <td>{a.subject}</td>
                                                <td className="audit-details">
                                                    {JSON.stringify(a.details)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </section>
            )}
            {edit && (
                <Editor
                    booking={["reservation.create", "reservation.update"].includes(edit.action)}
                    key={`${edit.action}-${edit.initial?.id || "new"}`}
                    secondaryAction={edit.action === "extras.save" && edit.initial?.id ? {
                        label: "Delete list",
                        disabled: data.products.some((p: Row) => (p.extra_group_ids || []).includes(edit.initial.id)),
                        onClick: () => openEditor(`Delete ${edit.initial.name}?`, "extras.delete", [], { id: edit.initial.id }),
                    } : undefined}
                    submitLabel={edit.action === "extras.delete" ? "Delete list" : edit.action === "extras.save" ? (edit.initial?.id ? "Update list" : "Create list") : "Save"}
                    description={edit.action === "extras.delete" ? "This permanently deletes the shared extras list. Existing order items and their prices stay unchanged." : edit.action === "extras.save" && edit.initial?.id && data.products.some((p: Row) => (p.extra_group_ids || []).includes(edit.initial.id)) ? "To delete this list, first remove it from the products using it." : undefined}
                    wide={edit.action === "extras.save" || edit.fields.length >= 4}
                    title={edit.title}
                    fields={edit.fields}
                    initial={edit.initial}
                    close={() => E(null)}
                    save={saveEditor}
                />
            )}
        </>
    );
}
function DayPanel({
    data,
    act,
    busy,
    openEditor,
}: {
    data: Row;
    act: Props["act"];
    busy: boolean;
    openEditor: (t: string, a: string, f: FieldSpec[], v?: Row) => void;
}) {
    return (
        <article className="panel section-title">
            <div className="section-heading">
                <div>
                    <h2>Business day</h2>
                    <p className="muted">
                        Review daily summaries before closing.
                    </p>
                </div>
                {data.day?.status === "open" ? (
                    <button
                        className="primary"
                        disabled={busy}
                        onClick={() =>
                            openEditor("Close business day", "day.close", [])
                        }
                    >
                        Close business day
                    </button>
                ) : (
                    <div className="button-row">
                        <button
                            className="primary"
                            disabled={busy}
                            onClick={() => act("day.open").catch(() => {})}
                        >
                            Start day
                        </button>
                        {data.day && (
                            <button
                                className="secondary"
                                onClick={() =>
                                    openEditor(
                                        "Reopen last day",
                                        "day.reopen",
                                        [
                                            {
                                                key: "reason",
                                                label: "Reason",
                                                required: true,
                                            },
                                        ],
                                        { day_id: data.day.id },
                                    )
                                }
                            >
                                Reopen
                            </button>
                        )}
                    </div>
                )}
            </div>
            {data.daily_summaries.map((s: Row) => (
                <div className="metric-line" key={s.id}>
                    <span>
                        {
                            data.employees.find((u: Row) => u.id === s.user_id)
                                ?.name
                        }
                    </span>
                    <Pill tone="good">Submitted</Pill>
                    <span>
                        {timestamp(s.submitted_at, data.settings.timezone)}
                    </span>
                </div>
            ))}
            {!data.daily_summaries.length && (
                <p className="muted">No cashier summaries submitted yet.</p>
            )}
            <h3>Recent business days</h3>
            {data.days.map((d: Row) => (
                <div className="metric-line" key={d.id}>
                    <strong>{d.business_date}</strong>
                    <Pill>{d.status}</Pill>
                    <span>
                        {timestamp(d.opened_at, data.settings.timezone)} —{" "}
                        {timestamp(d.closed_at, data.settings.timezone)}
                    </span>
                </div>
            ))}
        </article>
    );
}
function BusinessSettings({ data, act }: { data: Row; act: Props["act"] }) {
    const [v, S] = useState<Row>({
            ...data.settings,
            currency: data.settings.currency || "CAD",
            cash_rounding_cents: data.settings.cash_rounding_cents ?? 5,
            kitchen_output: "printer",
            kitchen_pin: "",
        }),
        [msg, M] = useState(""),
        [busy, B] = useState(false);
    return (
        <form
            className="panel settings-form"
            onSubmit={async (e) => {
                e.preventDefault();
                B(true);
                M("");
                try {
                    await act("settings.save", v);
                    M("Settings saved.");
                } catch (e) {
                    M((e as Error).message);
                } finally {
                    B(false);
                }
            }}
        >
            <h2>Business settings</h2>
            <Field label="Currency">
                <select
                    value={v.currency}
                    onChange={(e) => S({ ...v, currency: e.target.value, cash_rounding_cents: 1 })}
                >
                    {[
                        ["CAD", "Canadian dollar"], ["LKR", "Sri Lankan rupee"],
                        ["USD", "US dollar"], ["EUR", "Euro"], ["GBP", "British pound"],
                        ["AUD", "Australian dollar"], ["NZD", "New Zealand dollar"],
                        ["INR", "Indian rupee"], ["AED", "UAE dirham"], ["SAR", "Saudi riyal"],
                        ["SGD", "Singapore dollar"], ["MYR", "Malaysian ringgit"],
                        ["THB", "Thai baht"], ["PHP", "Philippine peso"],
                        ["ZAR", "South African rand"], ["CHF", "Swiss franc"],
                    ].map(([code, name]) => <option key={code} value={code}>{code} — {name}</option>)}
                </select>
                <small>Applies throughout the POS, including past sales and receipts. Amounts are not converted. Supports two-decimal currencies.</small>
            </Field>
            <Field label="Cash rounding">
                <select value={v.cash_rounding_cents} onChange={(e) => S({ ...v, cash_rounding_cents: Number(e.target.value) })}>
                    {[1, 5, 10, 25, 50, 100].map((n) => <option key={n} value={n}>{n === 1 ? "No rounding" : `Nearest ${(n / 100).toFixed(2)} ${v.currency}`}</option>)}
                </select>
                <small>Cash bills only; card amounts are unchanged. Selecting a currency resets this to no rounding.</small>
            </Field>
            <div className="form-grid">
                {[
                    ["business_name", "Business name"],
                    ["address", "Address"],
                    ["phone", "Phone"],
                    ["timezone", "Timezone · e.g. America/Toronto"],
                    ["booking_minutes", "Default booking duration in minutes"],
                    ["receipt_footer", "Receipt footer"],
                ].map(([k, label]) => (
                    <Field key={k} label={label}>
                        <input
                            type={
                                k === "kitchen_pin"
                                    ? "password"
                                    : k === "booking_minutes"
                                      ? "number"
                                      : "text"
                            }
                            value={v[k] || ""}
                            onChange={(e) => S({ ...v, [k]: e.target.value })}
                        />
                    </Field>
                ))}
            </div>
            <p className="muted">Kitchen screen access is disabled. Existing tickets are available under Print tickets. Automatic printer routing is on hold.</p>
            <h3>Taxes</h3>
            <p className="muted">
                Configure the restaurant’s applicable tax rules before live
                trading. No tax is assumed.
            </p>
            <label className="check">
                <input
                    type="checkbox"
                    checked={v.tax_inclusive}
                    onChange={(e) =>
                        S({ ...v, tax_inclusive: e.target.checked })
                    }
                />
                Prices include tax
            </label>
            {v.taxes.map((t: Row, i: number) => (
                <div className="tax-row" key={i}>
                    <Field label="Tax name">
                        <input
                            required
                            value={t.name}
                            onChange={(e) =>
                                S({
                                    ...v,
                                    taxes: v.taxes.map((x: Row, n: number) =>
                                        n === i
                                            ? { ...x, name: e.target.value }
                                            : x,
                                    ),
                                })
                            }
                        />
                    </Field>
                    <Field label="Rate %">
                        <input
                            type="number"
                            min="0"
                            max="30"
                            step=".01"
                            required
                            value={t.basis_points / 100}
                            onChange={(e) =>
                                S({
                                    ...v,
                                    taxes: v.taxes.map((x: Row, n: number) =>
                                        n === i
                                            ? {
                                                  ...x,
                                                  basis_points: Math.round(
                                                      Number(e.target.value) *
                                                          100,
                                                  ),
                                              }
                                            : x,
                                    ),
                                })
                            }
                        />
                    </Field>
                    <button
                        type="button"
                        className="text-button danger-text"
                        onClick={() =>
                            S({
                                ...v,
                                taxes: v.taxes.filter(
                                    (_: Row, n: number) => n !== i,
                                ),
                            })
                        }
                    >
                        Remove
                    </button>
                </div>
            ))}
            <button
                type="button"
                className="secondary"
                onClick={() =>
                    S({
                        ...v,
                        taxes: [...v.taxes, { name: "", basis_points: 0 }],
                    })
                }
            >
                Add tax rule
            </button>
            {msg && <p role="status">{msg}</p>}
            <button className="primary full" disabled={busy}>
                Save settings
            </button>
        </form>
    );
}
function localInput(value: string, tz: string) {
    if (!value) return "";
    const date = new Date(
        value.includes("T") ? value : value.replace(" ", "T") + "Z",
    );
    const parts = new Intl.DateTimeFormat("sv-SE", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).format(date);
    return parts.replace(" ", "T");
}
function bookingDefaults(minutes: number, tz: string) {
    const start = new Date(Date.now() + 3600000),
        end = new Date(start.getTime() + minutes * 60000);
    return {
        starts_at: localInput(start.toISOString(), tz),
        ends_at: localInput(end.toISOString(), tz),
    };
}
