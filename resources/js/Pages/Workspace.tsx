import React, { useState, useEffect, useCallback, useRef } from "react";
import { router, Head } from "@inertiajs/react";
import {
    Pencil,
    Pizza,
    LayoutGrid,
    Utensils,
    ChefHat,
    CalendarDays,
    ReceiptText,
    ChartNoAxesCombined,
    Users,
    Settings,
    LogOut,
    Plus,
    Search,
    Trash2,
    CreditCard,
    Banknote,
    CircleCheck,
    Wine,
    Flame,
    Clock,
    Bell,
    RefreshCw,
    Menu,
    X,
} from "lucide-react";
import Echo from "laravel-echo";
import Pusher from "pusher-js";
import {
    Row,
    useMoney,
    CurrencyContext,
    timestamp,
    key,
    api,
    Modal,
    Field,
    Pill,
    Empty,
    Stats,
    Editor,
} from "./ui";
import Management from "./Management";
import Reports from "./Reports";
import TablePreview from "./TablePreview";
const sections = [
    ["pos", "Point of sale", Pizza],
    ["tables", "Tables", Utensils],
    ["reservations", "Reservations", CalendarDays],
    ["kitchen", "Print tickets", ReceiptText],
    ["transactions", "Transactions", ReceiptText],
    ["profile", "My day", Clock],
    ["overview", "Overview", ChartNoAxesCombined],
    ["reports", "Reports", ReceiptText],
    ["team", "Team", Users],
    ["settings", "Manage", Settings],
] as const;
export default function Workspace({ initial }: { initial: Row }) {
    const [data, setData] = useState(initial),
        [view, setView] = useState(initial.kitchen_only ? "kitchen" : "pos"),
        [selected, setSelected] = useState<number | null>(null),
        [category, setCategory] = useState(0),
        [search, setSearch] = useState(""),
        [department, setDepartment] = useState("all"),
        [area, setArea] = useState("all"),
        [modal, setModal] = useState<Row | null>(null),
        [busy, setBusy] = useState(false),
        [error, setError] = useState(""),
        [toast, setToast] = useState(""),
        [connected, setConnected] = useState(true),
        [mobileNav, setMobileNav] = useState(false);
    const money = useMoney(data.settings.currency);
    const [printTicket, setPrintTicket] = useState<number | null>(null);
    const [sound, setSound] = useState(false);
    const audio = useRef<AudioContext | null>(null);
    const soundOn = useRef(false);
    const seenTickets = useRef(
        new Set<number>(initial.tickets.map((t: Row) => t.id)),
    );
    const beep = () => {
        const a = audio.current;
        if (!soundOn.current || !a) return;
        const o = a.createOscillator(),
            g = a.createGain();
        o.connect(g);
        g.connect(a.destination);
        o.frequency.value = 740;
        g.gain.value = 0.08;
        o.start();
        o.stop(a.currentTime + 0.22);
    };
    const seenReady = useRef(
        new Set<number>(
            initial.tickets
                .filter((t: Row) => t.status === "ready")
                .map((t: Row) => t.id),
        ),
    );
    const refresh = useCallback(async () => {
        try {
            const next = await api("/api/state");
            setData(next);
            setConnected(true);
            const ready = next.tickets.filter(
                (t: Row) =>
                    t.status === "ready" && !seenReady.current.has(t.id),
            );
            const incoming = next.tickets.filter(
                (t: Row) => !seenTickets.current.has(t.id),
            );
            if (incoming.length || ready.length) beep();
            next.tickets.forEach((t: Row) => seenTickets.current.add(t.id));
            if (ready.length)
                setToast(`${ready[0].label} · KOT #${ready[0].id} is ready`);
            next.tickets
                .filter((t: Row) => t.status === "ready")
                .forEach((t: Row) => seenReady.current.add(t.id));
        } catch {
            setConnected(false);
        }
    }, []);
    useEffect(() => {
        const interval = setInterval(refresh, 5000);
        return () => clearInterval(interval);
    }, [refresh]);
    useEffect(() => {
        if (!import.meta.env.VITE_REVERB_APP_KEY) return;
        const echo = new Echo({
            broadcaster: "reverb",
            client: new Pusher(import.meta.env.VITE_REVERB_APP_KEY, {
                wsHost: import.meta.env.VITE_REVERB_HOST || location.hostname,
                wsPort: Number(import.meta.env.VITE_REVERB_PORT || 8080),
                forceTLS: import.meta.env.VITE_REVERB_SCHEME === "https",
                enabledTransports: ["ws", "wss"],
                cluster: "mt1",
            }),
        });
        echo.channel("pos-refresh").listen(".updated", refresh);
        return () => echo.disconnect();
    }, [refresh]);
    useEffect(() => {
        if (toast) {
            const t = setTimeout(() => setToast(""), 6000);
            return () => clearTimeout(t);
        }
    }, [toast]);
    useEffect(() => {
        const offline = () => setConnected(false);
        const online = () => refresh();
        window.addEventListener("offline", offline);
        window.addEventListener("online", online);
        return () => {
            window.removeEventListener("offline", offline);
            window.removeEventListener("online", online);
        };
    }, [refresh]);
    const act = async (action: string, values: Row = {}) => {
        if (!connected || !navigator.onLine)
            throw new Error(
                "Connection lost. Wait for reconnection before continuing.",
            );
        setBusy(true);
        setError("");
        try {
            const result = await api("/api/actions/" + action, values);
            await refresh();
            if (
                result.result?.ticket_id &&
                ["printer", "both"].includes(data.settings.kitchen_output)
            )
                setPrintTicket(result.result.ticket_id);
            return result;
        } catch (e) {
            setError((e as Error).message);
            throw e;
        } finally {
            setBusy(false);
        }
    };
    const perform = async (action: string, values: Row = {}) => {
        try {
            return await act(action, values);
        } catch {
            return null;
        }
    };
    const manager = ["manager", "admin"].includes(data.user?.role),
        tz = data.settings.timezone,
        open = data.orders?.filter((o: Row) => o.status === "open") || [],
        order = data.orders?.find((o: Row) => o.id === selected),
        isOpen = order?.status === "open";
    const tableName = (id: number, type = "takeout") =>
        data.tables?.find((t: Row) => t.id === id)?.name || (type === "delivery" ? "Delivery" : "Takeaway");
    const create = async (values: Row) => {
        const result = await act("order.create", values);
        setSelected(result.result.id);
        setView("pos");
        setModal(null);
    };
    const statusAt = (table: Row) => {
        if (open.some((o: Row) => o.dining_table_id === table.id))
            return "occupied";
        return data.reservations.some(
            (r: Row) =>
                r.dining_table_id === table.id &&
                r.status === "upcoming" &&
                new Date(r.starts_at.replace(" ", "T") + "Z") <=
                    new Date(data.server_time) &&
                new Date(r.ends_at.replace(" ", "T") + "Z") >
                    new Date(data.server_time),
        )
            ? "reserved"
            : "available";
    };
    const runItem = async (product: Row, values: Row) => {
        if (!isOpen) {
            setModal({ type: "new" });
            return;
        }
        await act("order.add", {
            order_id: order.id,
            version: order.version,
            product_id: product.id,
            quantity: 1,
            modifiers: [],
            ...values,
        });
        setModal(null);
    };
    return (
        <CurrencyContext.Provider value={data.settings.currency || "CAD"}>
        <div className="app-shell">
            <Head title="Pizza & Bar POS" />
            <aside className={"rail " + (mobileNav ? "rail-open" : "")}>
                <a className="brand-mark" href="/" aria-label="Forno home">
                    <Pizza size={28} />
                </a>
                <button
                    className="mobile-close icon-button"
                    onClick={() => setMobileNav(false)}
                    aria-label="Close navigation"
                >
                    <X />
                </button>
                <nav>
                    {sections
                        .filter(([id]) =>
                            data.kitchen_only
                                ? id === "kitchen"
                                : manager ||
                                  ![
                                      "overview",
                                      "reports",
                                      "team",
                                      "settings",
                                  ].includes(id),
                        )
                        .map(([id, label, Icon]) => (
                            <button
                                key={id}
                                className={
                                    view === id ? "nav-item active" : "nav-item"
                                }
                                title={label}
                                aria-label={label}
                                onClick={() => {
                                    setView(id);
                                    setMobileNav(false);
                                }}
                            >
                                <Icon size={23} />
                                <span>{label}</span>
                            </button>
                        ))}
                </nav>
                <div className="rail-bottom">
                    <div
                        className="avatar tiny"
                        title={data.user?.name || "Kitchen"}
                    >
                        {data.user?.name?.[0] || "K"}
                    </div>
                    <button
                        className="nav-item"
                        aria-label="Sign out"
                        title="Sign out"
                        onClick={() => router.post("/logout")}
                    >
                        <LogOut size={21} />
                        <span>Sign out</span>
                    </button>
                </div>
            </aside>
            <main className="main">
                <header className="topbar">
                    <div className="header-title">
                        <button
                            className="mobile-menu icon-button"
                            aria-label="Open navigation"
                            onClick={() => setMobileNav(true)}
                        >
                            <Menu />
                        </button>
                        <div>
                            <span className="eyebrow">
                                {data.settings.business_name}
                            </span>
                            <h1>{sections.find(([id]) => id === view)?.[1]}</h1>
                        </div>
                    </div>
                    <div className="top-actions">
                        <span className="date">
                            {timestamp(data.server_time, tz)}
                        </span>
                        <Pill tone={connected ? "good" : "danger"}>
                            {connected ? "Connected" : "Connection lost"}
                        </Pill>
                        {manager && data.day?.status === "open" && <button className="secondary" onClick={() => setView("overview")}>Close day</button>}
                        {!data.kitchen_only && (
                            <Pill
                                tone={
                                    data.day?.status === "open"
                                        ? "good"
                                        : "neutral"
                                }
                            >
                                {data.day?.status === "open"
                                    ? "Day open"
                                    : "Day closed"}
                            </Pill>
                        )}
                        <button
                            className="secondary"
                            aria-pressed={sound}
                            onClick={async () => {
                                if (!audio.current)
                                    audio.current = new AudioContext();
                                await audio.current.resume();
                                soundOn.current = !sound;
                                setSound(!sound);
                                beep();
                            }}
                        >
                            <Bell size={17} />
                            {sound ? "Sound on" : "Sound off"}
                        </button>
                        <button
                            className="icon-button"
                            aria-label="Refresh"
                            onClick={refresh}
                        >
                            <RefreshCw size={19} />
                        </button>
                    </div>
                </header>
                {error && (
                    <div className="error banner" role="alert">
                        {error}
                        <button
                            className="text-button"
                            onClick={() => setError("")}
                        >
                            Dismiss
                        </button>
                    </div>
                )}
                {printTicket && (
                    <div
                        className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-4"
                        role="status"
                    >
                        <span>
                            Kitchen ticket #{printTicket} is ready to print.
                        </span>
                        <a
                            className="primary"
                            href={"/kitchen-tickets/" + printTicket + "/print"}
                            target="_blank"
                            rel="noreferrer"
                        >
                            Print KOT
                        </a>
                        <button
                            className="text-button"
                            onClick={() => setPrintTicket(null)}
                        >
                            Dismiss
                        </button>
                    </div>
                )}
                {toast && (
                    <div className="toast" role="status">
                        <Bell size={18} />
                        {toast}
                    </div>
                )}
                {!data.kitchen_only && data.day?.status !== "open" && (
                    <div className="day-banner">
                        <Clock size={20} />
                        <span>
                            The business day is closed.{" "}
                            {manager
                                ? "Start the day when your team is ready."
                                : "Ask Manager or Admin to start the day."}
                        </span>
                        {manager && (
                            <button
                                className="primary"
                                disabled={busy}
                                onClick={() => perform("day.open")}
                            >
                                Start day
                            </button>
                        )}
                    </div>
                )}
                {!connected && (
                    <div className="error" role="alert">
                        Connection lost. Work is on hold until the server
                        reconnects. Unsaved actions are not queued.
                    </div>
                )}
                <fieldset className="workspace-content" disabled={!connected}>
                    {view === "pos" && (
                        <div className="pos-layout">
                            <section className="menu-panel">
                                <div className="section-heading">
                                    <div>
                                        <h2>
                                            {department === "bar"
                                                ? "At the bar"
                                                : "What’s cooking?"}
                                        </h2>
                                        <p className="muted">
                                            1. Start an order · 2. Add items ·
                                            3. Review and pay
                                        </p>
                                    </div>
                                    <button
                                        className="primary"
                                        disabled={
                                            busy || data.day?.status !== "open"
                                        }
                                        onClick={() =>
                                            setModal({ type: "new" })
                                        }
                                    >
                                        <Plus size={18} />
                                        New order
                                    </button>
                                </div>
                                <div
                                    className="department-switch"
                                    aria-label="Menu department"
                                >
                                    {["all", "restaurant", "bar"].map((d) => (
                                        <button
                                            key={d}
                                            aria-pressed={department === d}
                                            className={
                                                department === d
                                                    ? "selected"
                                                    : ""
                                            }
                                            onClick={() => {
                                                setDepartment(d);
                                                setCategory(0);
                                                setSearch("");
                                            }}
                                        >
                                            {d === "all"
                                                ? "All items"
                                                : d === "bar"
                                                  ? "Bar"
                                                  : "Restaurant"}
                                        </button>
                                    ))}
                                </div>
                                <div className="search">
                                    <Search size={19} />
                                    <input
                                        aria-label="Search menu"
                                        placeholder="Search pizza, drinks and more…"
                                        value={search}
                                        onChange={(e) =>
                                            setSearch(e.target.value)
                                        }
                                    />
                                </div>
                                <div className="category-row">
                                    <button
                                        className={
                                            "category " +
                                            (!category ? "selected" : "")
                                        }
                                        onClick={() => setCategory(0)}
                                    >
                                        <LayoutGrid size={20} />
                                        All items
                                    </button>
                                    {data.categories.filter((c: Row) => data.products.some((p: Row) => p.active && p.category_id === c.id && (department === "all" || p.department === department))).map((c: Row) => (
                                        <button
                                            key={c.id}
                                            className={
                                                "category " +
                                                (category === c.id
                                                    ? "selected"
                                                    : "")
                                            }
                                            onClick={() => setCategory(c.id)}
                                        >
                                            {c.name === "Bar" ? (
                                                <Wine size={20} />
                                            ) : (
                                                <Pizza size={20} />
                                            )}{" "}
                                            {c.name}
                                        </button>
                                    ))}
                                </div>
                                <div className="product-grid">
                                    {data.products
                                        .filter(
                                            (p: Row) =>
                                                p.active &&
                                                (department === "all" ||
                                                    p.department ===
                                                        department) &&
                                                (!category ||
                                                    p.category_id ===
                                                        category) &&
                                                p.name
                                                    .toLowerCase()
                                                    .includes(
                                                        search.toLowerCase(),
                                                    ),
                                        )
                                        .map((p: Row) => (
                                            <button
                                                disabled={busy}
                                                key={p.id}
                                                className="product-card"
                                                onClick={() =>
                                                    !isOpen
                                                        ? setModal({
                                                              type: "new",
                                                          })
                                                        : p.variants?.length ||
                                                            p.modifiers?.length
                                                          ? setModal({
                                                                type: "product",
                                                                product: p,
                                                            })
                                                          : runItem(
                                                                p,
                                                                {},
                                                            ).catch(() => {})
                                                }
                                            >
                                                <div
                                                    className={
                                                        "product-art art-" +
                                                        (p.category_id % 4)
                                                    }
                                                >
                                                    {p.photo ? (
                                                        <img
                                                            src={p.photo}
                                                            alt=""
                                                            loading="lazy"
                                                        />
                                                    ) : p.kitchen ? (
                                                        <Pizza
                                                            size={48}
                                                            strokeWidth={1.25}
                                                        />
                                                    ) : (
                                                        <Wine
                                                            size={46}
                                                            strokeWidth={1.25}
                                                        />
                                                    )}
                                                    <span className="product-tag">
                                                        {p.department === "bar"
                                                            ? "Bar"
                                                            : "Restaurant"}
                                                    </span>
                                                </div>
                                                <h3>{p.name}</h3>
                                                <div className="product-bottom">
                                                    <strong>
                                                        {money(
                                                            ["takeout", "delivery"].includes(order?.type)
                                                                ? (p.takeout_price_cents ??
                                                                      p.price_cents)
                                                                : p.price_cents,
                                                        )}
                                                    </strong>
                                                    <span className="add-dot">
                                                        <Plus size={18} />
                                                    </span>
                                                </div>
                                            </button>
                                        ))}
                                </div>
                            </section>
                            <aside className="order-panel">
                                {open.length > 0 && (
                                    <details
                                        className="running-orders"
                                        open={open.length <= 3}
                                    >
                                        <summary>
                                            Running orders ({open.length})
                                        </summary>
                                        {open.map((o: Row) => {
                                            const ticket = data.tickets
                                                .filter(
                                                    (t: Row) =>
                                                        t.order_id === o.id,
                                                )
                                                .at(-1);
                                            return (
                                                <button
                                                    key={o.id}
                                                    className={
                                                        selected === o.id
                                                            ? "running-order selected"
                                                            : "running-order"
                                                    }
                                                    onClick={() =>
                                                        setSelected(o.id)
                                                    }
                                                >
                                                    <span>
                                                        <strong>
                                                            {tableName(o.dining_table_id, o.type)}{" "}
                                                            · #{o.id}
                                                        </strong>
                                                        <small>
                                                            {o.customer_name ||
                                                                "Guest"}{" "}
                                                            ·{" "}
                                                            {Math.max(
                                                                0,
                                                                Math.floor(
                                                                    (Date.parse(
                                                                        data.server_time,
                                                                    ) -
                                                                        Date.parse(
                                                                            o.created_at.replace(
                                                                                " ",
                                                                                "T",
                                                                            ) +
                                                                                "Z",
                                                                        )) /
                                                                        60000,
                                                                ),
                                                            )}{" "}
                                                            min ·{" "}
                                                            {ticket?.status ||
                                                                "Not sent"}
                                                        </small>
                                                    </span>
                                                    <strong>
                                                        {money(o.total_cents)}
                                                    </strong>
                                                </button>
                                            );
                                        })}
                                    </details>
                                )}

                                <div className="section-heading">
                                    <div>
                                        <span className="eyebrow">
                                            CURRENT ORDER
                                        </span>
                                        <h2>
                                            {order
                                                ? tableName(order.dining_table_id, order.type)
                                                : "Start something good"}
                                        </h2>
                                    </div>
                                    {order && <Pill>{order.status}</Pill>}
                                </div>
                                <select
                                    aria-label="Select open order"
                                    value={selected ?? ""}
                                    onChange={(e) =>
                                        setSelected(Number(e.target.value))
                                    }
                                >
                                    <option value="">
                                        Choose an open order
                                    </option>
                                    {open.map((o: Row) => (
                                        <option key={o.id} value={o.id}>
                                            #{String(o.id).padStart(4, "0")} ·{" "}
                                            {tableName(o.dining_table_id, o.type)}{" "}
                                            {o.customer_name || ""}
                                        </option>
                                    ))}
                                </select>
                                {order && <div className="order-details"><strong>{order.type === "delivery" ? "Delivery" : order.type === "takeout" ? "Takeaway" : "Dine-in"}</strong>{order.type === "delivery" && <p>{order.customer_name} | {order.phone}<br />{order.delivery_address}<br />Delivery fee: {money(order.delivery_fee_cents)}</p>}{order.notes && <p>{order.notes}</p>}{isOpen && <button className="secondary" onClick={() => setModal({type:"notes",order})}>{order.notes ? "Edit order note" : "Add order note"}</button>}</div>}
                                {!order ? (
                                    <Empty text="Create an order or select an occupied table to start." />
                                ) : (
                                    <>
                                        <div className="order-meta">
                                            <span>
                                                Order #
                                                {String(order.id).padStart(
                                                    4,
                                                    "0",
                                                )}
                                            </span>
                                            <span>
                                                {
                                                    data.employees.find(
                                                        (u: Row) =>
                                                            u.id ===
                                                            order.attended_by,
                                                    )?.name
                                                }
                                            </span>
                                        </div>
                                        <div className="order-items">
                                            {order.items
                                                .filter(
                                                    (i: Row) => i.quantity > 0,
                                                )
                                                .map((item: Row) => (
                                                    <div
                                                        className="order-item"
                                                        key={item.id}
                                                    >
                                                        <div className="qty">
                                                            {item.quantity}
                                                        </div>
                                                        <div className="item-description">
                                                            <strong>
                                                                {item.name}
                                                            </strong>
                                                            <small>
                                                                {item.configuration?.join(
                                                                    " · ",
                                                                )}
                                                            </small>
                                                            {item.notes && (
                                                                <small>
                                                                    {item.notes}
                                                                </small>
                                                            )}
                                                            <small
                                                                className={
                                                                    item.sent_quantity
                                                                        ? "sent"
                                                                        : "muted"
                                                                }
                                                            >
                                                                {item.kitchen
                                                                    ? item.sent_quantity
                                                                        ? "Sent to kitchen"
                                                                        : "Not sent"
                                                                    : "No KOT"}
                                                            </small>
                                                        </div>
                                                        <div>
                                                            <strong>
                                                                {money(
                                                                    item.unit_cents *
                                                                        item.quantity,
                                                                )}
                                                            </strong>
                                                            {isOpen && (
                                                                <button
                                                                    className="remove-button"
                                                                    aria-label={
                                                                        "Edit " +
                                                                        item.name
                                                                    }
                                                                    onClick={() =>
                                                                        setModal(
                                                                            {
                                                                                type: "amend",
                                                                                item,
                                                                            },
                                                                        )
                                                                    }
                                                                >
                                                                    <Pencil
                                                                        size={
                                                                            15
                                                                        }
                                                                    />
                                                                </button>
                                                            )}
                                                            {isOpen && (
                                                                <button
                                                                    className="remove-button"
                                                                    aria-label={
                                                                        "Remove " +
                                                                        item.name
                                                                    }
                                                                    onClick={() =>
                                                                        setModal(
                                                                            {
                                                                                type: "remove",
                                                                                item,
                                                                            },
                                                                        )
                                                                    }
                                                                >
                                                                    <Trash2
                                                                        size={
                                                                            15
                                                                        }
                                                                    />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            {!order.items.some(
                                                (i: Row) => i.quantity > 0,
                                            ) && (
                                                <Empty text="Tap a menu item to add it." />
                                            )}
                                        </div>
                                        <div className="bill">
                                            <div>
                                                <span>Subtotal</span>
                                                <span>
                                                    {money(
                                                        order.subtotal_cents,
                                                    )}
                                                </span>
                                            </div>
                                            <div>
                                                <span>
                                                    {order.promotion_name ||
                                                        "Discount"}
                                                </span>
                                                <span>
                                                    −
                                                    {money(
                                                        order.discount_cents,
                                                    )}
                                                </span>
                                            </div>
                                            <div>
                                                <span>
                                                    Tax{" "}
                                                    {order.tax_snapshot
                                                        ?.inclusive
                                                        ? "(included)"
                                                        : ""}
                                                </span>
                                                <span>
                                                    {money(order.tax_cents)}
                                                </span>
                                            </div>
                                            <div className="bill-total">
                                                <span>Total</span>
                                                <strong>
                                                    {money(order.total_cents)}
                                                </strong>
                                            </div>
                                        </div>
                                        {isOpen ? (
                                            <>
                                                <button
                                                    className="secondary full"
                                                    disabled={busy}
                                                    onClick={() =>
                                                        setModal({
                                                            type: "promotion",
                                                        })
                                                    }
                                                >
                                                    Discount or promo code
                                                </button>
                                                <div className="payment-buttons">
                                                    
                                                    <button
                                                        className="primary"
                                                        disabled={
                                                            busy ||
                                                            !order.items.some(
                                                                (i: Row) =>
                                                                    i.quantity >
                                                                    0,
                                                            )
                                                        }
                                                        onClick={() =>
                                                            setModal({
                                                                type: "pay",
                                                            })
                                                        }
                                                    >
                                                        <CreditCard size={18} />
                                                        Pay
                                                    </button>
                                                </div>
                                                <button
                                                    className="text-button danger-text full"
                                                    onClick={() =>
                                                        setModal({
                                                            type: "cancel",
                                                        })
                                                    }
                                                >
                                                    Cancel order
                                                </button>
                                            </>
                                        ) : (
                                            <a
                                                className="primary full"
                                                href={"/receipts/" + order.id}
                                                target="_blank"
                                                rel="noreferrer"
                                            >
                                                View receipt
                                            </a>
                                        )}
                                    </>
                                )}
                            </aside>
                        </div>
                    )}
                    {view === "tables" && (
                        <section>
                            <div className="section-heading">
                                <div>
                                    <h2>A place for everyone</h2>
                                    <p className="muted">
                                        {
                                            open.filter(
                                                (o: Row) =>
                                                    o.type === "dine_in",
                                            ).length
                                        }{" "}
                                        occupied ·{" "}
                                        {
                                            data.tables.filter(
                                                (t: Row) => t.active,
                                            ).length
                                        }{" "}
                                        tables
                                    </p>
                                </div>
                                <button
                                    className="primary"
                                    onClick={() => setModal({ type: "new" })}
                                >
                                    <Plus size={18} />
                                    Takeout order
                                </button>
                            </div>
                            <div
                                className="department-switch"
                                aria-label="Table area"
                            >
                                {[
                                    "all",
                                    ...Array.from(
                                        new Set<string>(
                                            data.tables.map((t: Row) => t.area),
                                        ),
                                    ),
                                ].map((a) => (
                                    <button
                                        key={a}
                                        className={area === a ? "selected" : ""}
                                        onClick={() => setArea(a)}
                                    >
                                        {a === "all" ? "All areas" : a}
                                    </button>
                                ))}
                            </div>
                            <div className="table-grid">
                                {data.tables
                                    .filter(
                                        (t: Row) =>
                                            t.active &&
                                            (area === "all" || t.area === area),
                                    )
                                    .map((t: Row) => {
                                        const status = statusAt(t),
                                            o = open.find(
                                                (o: Row) =>
                                                    o.dining_table_id === t.id,
                                            ),
                                            next = data.reservations.find(
                                                (r: Row) =>
                                                    r.dining_table_id ===
                                                        t.id &&
                                                    r.status === "upcoming" &&
                                                    new Date(
                                                        r.ends_at.replace(
                                                            " ",
                                                            "T",
                                                        ) + "Z",
                                                    ) >
                                                        new Date(
                                                            data.server_time,
                                                        ),
                                            );
                                        return (
                                            <article
                                                className={
                                                    "table-card " + status
                                                }
                                                key={t.id}
                                            >
                                                <button className="table-card-open" aria-label={`Open ${t.name}`}
                                                onClick={() => {
                                                    if (o) {
                                                        setSelected(o.id);
                                                        setView("pos");
                                                    } else if (
                                                        status === "reserved"
                                                    ) {
                                                        setView("reservations");
                                                    } else
                                                        setModal({
                                                            type: "new",
                                                            table_id: t.id,
                                                        });
                                                }}
                                            >
                                                <div className="table-top">
                                                    <Pill
                                                        tone={
                                                            status ===
                                                            "available"
                                                                ? "good"
                                                                : status ===
                                                                    "occupied"
                                                                  ? "warm"
                                                                  : "neutral"
                                                        }
                                                    >
                                                        {status}
                                                    </Pill>
                                                    <span>{t.seats} seats</span>
                                                </div>
                                                <Utensils
                                                    size={38}
                                                    strokeWidth={1.2}
                                                />
                                                <h2>{t.name}</h2>
                                                <small>{t.area}</small>
                                                <strong>
                                                    {o
                                                        ? money(o.total_cents)
                                                        : "Ready to welcome"}
                                                </strong>
                                                {next && (
                                                    <small>
                                                        Booking ·{" "}
                                                        {timestamp(
                                                            next.starts_at,
                                                            tz,
                                                        )}
                                                    </small>
                                                )}
                                                </button>
                                                <button className="secondary table-view-button" aria-label={`View ${t.name} with chairs`} onClick={() => setModal({type:"table-preview", table:t})}>View</button>
                                            </article>
                                        );
                                    })}
                            </div>
                        </section>
                    )}
                    {view === "kitchen" && (
                        <Kitchen
                            data={data}
                            refresh={refresh}
                            setError={setError}
                        />
                    )}
                    {view === "reports" && <Reports timezone={tz} />}
                    {!["pos", "tables", "kitchen", "reports"].includes(
                        view,
                    ) && (
                        <Management
                            view={view}
                            data={data}
                            act={act}
                            busy={busy}
                            openOrder={(id: number) => {
                                setSelected(id);
                                setView("pos");
                            }}
                            seat={async (r: Row) =>
                                create({
                                    key: key(),
                                    type: "dine_in",
                                    table_id: r.dining_table_id,
                                    reservation_id: r.id,
                                    attended_by: data.user.id,
                                    customer_name: r.name,
                                })
                            }
                            refund={(o: Row) =>
                                setModal({ type: "refund", order: o })
                            }
                        />
                    )}
                </fieldset>
            </main>
            {modal?.type === "table-preview" && <TablePreview table={data.tables.find((t: Row) => t.id === modal.table.id) || modal.table} status={statusAt(data.tables.find((t: Row) => t.id === modal.table.id) || modal.table)} close={() => setModal(null)} />}
            {modal?.type === "notes" && <Editor title="Order note" fields={[{key:"notes",label:"Note (optional)",type:"textarea"}]} initial={{notes:modal.order.notes || ""}} close={() => setModal(null)} save={async (v) => { await act("order.notes", {order_id:modal.order.id,version:modal.order.version,...v}); }} />}
            {modal?.type === "new" && (
                <NewOrder
                    data={data}
                    initialTable={modal.table_id}
                    close={() => setModal(null)}
                    save={create}
                />
            )}
            {modal?.type === "product" && (
                <ProductModal
                    product={{
                        ...modal.product,
                        price_cents:
                            ["takeout", "delivery"].includes(order?.type)
                                ? (modal.product.takeout_price_cents ??
                                  modal.product.price_cents)
                                : modal.product.price_cents,
                    }}
                    close={() => setModal(null)}
                    save={(v) => runItem(modal.product, v)}
                />
            )}
            {modal && ["cancel", "remove"].includes(modal.type) && (
                <ReasonModal
                    title={
                        modal.type === "cancel" ? "Cancel order" : "Remove item"
                    }
                    close={() => setModal(null)}
                    save={async (reason) => {
                        await act(
                            modal.type === "cancel"
                                ? "order.cancel"
                                : "order.remove",
                            {
                                order_id: order.id,
                                version: order.version,
                                item_id: modal.item?.id,
                                reason,
                            },
                        );
                        setModal(null);
                    }}
                />
            )}
            {modal?.type === "amend" && (
                <AmendModal
                    item={modal.item}
                    close={() => setModal(null)}
                    save={async (v) => {
                        await act("order.amend", {
                            order_id: order.id,
                            version: order.version,
                            item_id: modal.item.id,
                            ...v,
                        });
                        setModal(null);
                    }}
                />
            )}
            {modal?.type === "pay" && (
                <PayModal
                    order={order}
                    data={data}
                    close={() => setModal(null)}
                    save={async (v) => {
                        await act("order.pay", {
                            order_id: order.id,
                            version: order.version,
                            ...v,
                        });
                        setModal(null);
                        setToast("Payment recorded. Receipt is ready.");
                    }}
                />
            )}
            {modal?.type === "promotion" && (
                <PromotionModal
                    data={data}
                    order={order}
                    close={() => setModal(null)}
                    save={async (v) => {
                        await act("order.promotion", {
                            order_id: order.id,
                            version: order.version,
                            ...v,
                        });
                        setModal(null);
                    }}
                />
            )}
            {modal?.type === "refund" && (
                <RefundModal
                    order={modal.order}
                    data={data}
                    close={() => setModal(null)}
                    save={async (v) => {
                        await act("order.refund", {
                            order_id: modal.order.id,
                            ...v,
                        });
                        setModal(null);
                        setToast("Full refund recorded.");
                    }}
                />
            )}
        </div>
        </CurrencyContext.Provider>
    );
}
function NewOrder({
    data,
    initialTable,
    close,
    save,
}: {
    data: Row;
    initialTable?: number;
    close: () => void;
    save: (v: Row) => Promise<any>;
}) {
    const [v, set] = useState<Row>({
            key: key(),
            type: initialTable ? "dine_in" : "takeout",
            table_id: initialTable || "",
            attended_by: data.user.id,
            customer_name: "",
            phone: "",
            delivery_address: "",
            delivery_fee: "0",
        }),
        [error, E] = useState(""),
        [busy, B] = useState(false);
    return (
        <Modal title="New order" close={close}>
            <form
                onSubmit={async (e) => {
                    e.preventDefault();
                    B(true);
                    try {
                        await save({
                            ...v,
                            table_id:
                                v.type === "dine_in"
                                    ? Number(v.table_id)
                                    : null,
                            attended_by: Number(v.attended_by),
                        });
                    } catch (e) {
                        E((e as Error).message);
                    } finally {
                        B(false);
                    }
                }}
            >
                <div className="segmented">
                    <button
                        type="button"
                        className={v.type === "dine_in" ? "selected" : ""}
                        onClick={() => set({ ...v, type: "dine_in" })}
                    >
                        Dine-in
                    </button>
                    <button
                        type="button"
                        className={v.type === "takeout" ? "selected" : ""}
                        onClick={() => set({ ...v, type: "takeout" })}
                    >
                        Takeaway
                    </button>
                    <button type="button" className={v.type === "delivery" ? "selected" : ""} onClick={() => set({ ...v, type: "delivery" })}>Delivery</button>
                </div>
                <div className="form-grid">
                    {v.type === "dine_in" && (
                        <Field label="Table">
                            <select
                                required
                                value={v.table_id}
                                onChange={(e) =>
                                    set({ ...v, table_id: e.target.value })
                                }
                            >
                                <option value="">Select table</option>
                                {data.tables
                                    .filter(
                                        (t: Row) =>
                                            t.active &&
                                            !data.orders.some(
                                                (o: Row) =>
                                                    o.status === "open" &&
                                                    o.dining_table_id === t.id,
                                            ),
                                    )
                                    .map((t: Row) => (
                                        <option key={t.id} value={t.id}>
                                            {t.name}
                                        </option>
                                    ))}
                            </select>
                        </Field>
                    )}
                    <Field label="Attended by">
                        <select
                            value={v.attended_by}
                            onChange={(e) =>
                                set({ ...v, attended_by: e.target.value })
                            }
                        >
                            {data.employees
                                .filter((u: Row) => u.active)
                                .map((u: Row) => (
                                    <option key={u.id} value={u.id}>
                                        {u.name}
                                    </option>
                                ))}
                        </select>
                    </Field>
                    {v.type === "delivery" && <><Field label="Delivery address"><textarea required maxLength={500} value={v.delivery_address} onChange={(e) => set({ ...v, delivery_address: e.target.value })} /></Field><Field label="Delivery fee (optional)"><input type="number" min="0" step="0.01" value={v.delivery_fee} onChange={(e) => set({ ...v, delivery_fee: e.target.value })} /><small>Included in the bill subtotal; order taxes and discounts apply.</small></Field></>}
                    {["customer_name", "phone"].map((k) => (
                        <Field
                            label={
                                {
                                    customer_name: "Customer name",
                                    phone: "Phone",
                                    notes: "Order notes",
                                }[k]!
                            }
                            key={k}
                        >
                            <input
                                required={v.type === "delivery"}
                                value={v[k]}
                                onChange={(e) =>
                                    set({ ...v, [k]: e.target.value })
                                }
                            />
                        </Field>
                    ))}
                </div>
                {error && <p className="error">{error}</p>}
                <button className="primary full" disabled={busy}>
                    Create order
                </button>
            </form>
        </Modal>
    );
}
function ProductModal({
    product: p,
    close,
    save,
}: {
    product: Row;
    close: () => void;
    save: (v: Row) => Promise<any>;
}) {
    const money = useMoney();
    const [variant, V] = useState(p.variants?.[0]?.name || ""),
        [mods, M] = useState<string[]>([]),
        [quantity, Q] = useState(1),
        [notes, N] = useState(""),
        [busy, B] = useState(false),
        [err, E] = useState("");
    const price =
        (p.variants?.find((v: Row) => v.name === variant)?.price_cents ??
            p.price_cents) +
        (p.modifiers || [])
            .filter((m: Row) => mods.includes(m.name))
            .reduce((n: number, m: Row) => n + m.price_cents, 0);
    return (
        <Modal title={p.name} close={close}>
            <form
                onSubmit={async (e) => {
                    e.preventDefault();
                    B(true);
                    try {
                        await save({
                            variant,
                            modifiers: mods,
                            quantity,
                            notes,
                        });
                    } catch (e) {
                        E((e as Error).message);
                    } finally {
                        B(false);
                    }
                }}
            >
                {p.variants?.length > 0 && (
                    <Field label="Size">
                        <select
                            value={variant}
                            onChange={(e) => V(e.target.value)}
                        >
                            {p.variants.map((v: Row) => (
                                <option key={v.name}>{v.name}</option>
                            ))}
                        </select>
                    </Field>
                )}
                <div className="modifier-list">
                    {p.modifiers?.map((m: Row) => (
                        <label key={m.name}>
                            <input
                                type="checkbox"
                                checked={mods.includes(m.name)}
                                onChange={(e) =>
                                    M(
                                        e.target.checked
                                            ? [...mods, m.name]
                                            : mods.filter((x) => x !== m.name),
                                    )
                                }
                            />
                            <span>{m.name}</span>
                            <strong>+{money(m.price_cents)}</strong>
                        </label>
                    ))}
                </div>
                <Field label="Quantity">
                    <input
                        type="number"
                        min="1"
                        max="99"
                        value={quantity}
                        onChange={(e) => Q(Number(e.target.value))}
                    />
                </Field>
                <Field label="Kitchen instructions">
                    <input
                        placeholder="e.g. No onions"
                        value={notes}
                        onChange={(e) => N(e.target.value)}
                    />
                </Field>
                {err && <p className="error">{err}</p>}
                <button className="primary full" disabled={busy}>
                    Add to order · {money(price * quantity)}
                </button>
            </form>
        </Modal>
    );
}
function ReasonModal({
    title,
    close,
    save,
}: {
    title: string;
    close: () => void;
    save: (s: string) => Promise<any>;
}) {
    const [reason, R] = useState(""),
        [busy, B] = useState(false);
    return (
        <Modal title={title} close={close}>
            <form
                onSubmit={async (e) => {
                    e.preventDefault();
                    B(true);
                    try {
                        await save(reason);
                    } catch {
                    } finally {
                        B(false);
                    }
                }}
            >
                <p className="muted">
                    The change stays in the audit history. Sent food will notify
                    the kitchen.
                </p>
                <Field label="Reason">
                    <textarea
                        required
                        minLength={3}
                        value={reason}
                        onChange={(e) => R(e.target.value)}
                    />
                </Field>
                <button disabled={busy} className="primary full">
                    Confirm
                </button>
            </form>
        </Modal>
    );
}
function PayModal({
    order: o,
    data,
    close,
    save,
}: {
    order: Row;
    data: Row;
    close: () => void;
    save: (v: Row) => Promise<any>;
}) {
    const money = useMoney();
    const increment = Number(data.settings.cash_rounding_cents ?? 5);
    const [v, S] = useState<Row>({
            key: key(),
            method: "cash",
            tip: "0",
            tendered: ((Math.round(o.total_cents / increment) * increment) / 100).toFixed(2),
            terminal_id: data.terminals.find((t: Row) => t.active)?.id || "",
            reference: "",
            external_confirmed: false,
        }),
        [busy, B] = useState(false),
        [error, E] = useState("");
    const bill =
        v.method === "cash" ? Math.round(o.total_cents / increment) * increment : o.total_cents;
    const tip = Math.round(Number(v.tip || 0) * 100);
    return (
        <Modal title="Complete payment" close={close}>
            <form
                onSubmit={async (e) => {
                    e.preventDefault();
                    B(true);
                    try {
                        await save({
                            ...v,
                            tip: v.tip || "0",
                            terminal_id:
                                v.method === "card"
                                    ? Number(v.terminal_id)
                                    : null,
                        });
                    } catch (e) {
                        E((e as Error).message);
                    } finally {
                        B(false);
                    }
                }}
            >
                <div className="payment-amount">
                    <span>Amount due</span>
                    <strong>{money(bill)}</strong>
                </div>
                <div className="segmented">
                    {["cash", "card"].map((m) => (
                        <button
                            type="button"
                            key={m}
                            className={v.method === m ? "selected" : ""}
                            onClick={() => S({ ...v, method: m })}
                        >
                            {m === "cash" ? (
                                <Banknote size={20} />
                            ) : (
                                <CreditCard size={20} />
                            )}{" "}
                            {m}
                        </button>
                    ))}
                </div>
                <Field label="Tip · optional">
                    <input
                        type="number"
                        min="0"
                        step=".01"
                        value={v.tip}
                        onChange={(e) => S({ ...v, tip: e.target.value })}
                    />
                </Field>
                {v.method === "cash" ? (
                    <>
                        <Field label="Cash received">
                            <input
                                required
                                type="number"
                                min="0"
                                step=".01"
                                value={v.tendered}
                                onChange={(e) =>
                                    S({ ...v, tendered: e.target.value })
                                }
                            />
                        </Field>
                        <div className="bill-total">
                            Change{" "}
                            <strong>
                                {money(
                                    Math.max(
                                        0,
                                        Math.round(Number(v.tendered) * 100) -
                                            bill -
                                            tip,
                                    ),
                                )}
                            </strong>
                        </div>
                    </>
                ) : (
                    <>
                        <Field label="Payment terminal">
                            <select
                                required
                                value={v.terminal_id}
                                onChange={(e) =>
                                    S({ ...v, terminal_id: e.target.value })
                                }
                            >
                                {data.terminals
                                    .filter((t: Row) => t.active)
                                    .map((t: Row) => (
                                        <option key={t.id} value={t.id}>
                                            {t.name}
                                        </option>
                                    ))}
                            </select>
                        </Field>
                        <p className="instruction">
                            Process <strong>{money(bill + tip)}</strong> on the
                            physical terminal.
                        </p>
                        <Field label="Approval reference">
                            <input
                                required
                                value={v.reference}
                                onChange={(e) =>
                                    S({ ...v, reference: e.target.value })
                                }
                            />
                        </Field>
                        <label className="check">
                            <input
                                type="checkbox"
                                required
                                checked={v.external_confirmed}
                                onChange={(e) =>
                                    S({
                                        ...v,
                                        external_confirmed: e.target.checked,
                                    })
                                }
                            />
                            The terminal approved this payment.
                        </label>
                    </>
                )}
                {error && <p className="error">{error}</p>}
                <button disabled={busy} className="primary full">
                    {busy ? "Recording…" : "Confirm payment"} ·{" "}
                    {money(bill + tip)}
                </button>
            </form>
        </Modal>
    );
}
function PromotionModal({
    data,
    order,
    close,
    save,
}: {
    data: Row;
    order: Row;
    close: () => void;
    save: (v: Row) => Promise<any>;
}) {
    const [id, I] = useState(""),
        [code, C] = useState(""),
        [error, E] = useState(""),
        [busy, B] = useState(false);
    return (
        <Modal title="Discount or promo" close={close}>
            <form
                onSubmit={async (e) => {
                    e.preventDefault();
                    B(true);
                    try {
                        await save({
                            promotion_id: code ? null : id ? Number(id) : null,
                            code: code || null,
                        });
                    } catch (e) {
                        E((e as Error).message);
                    } finally {
                        B(false);
                    }
                }}
            >
                <p className="muted">
                    Only one offer per order. This replaces{" "}
                    {order.promotion_name || "any existing offer"}.
                </p>
                <Field label="Predefined discount">
                    <select
                        value={id}
                        onChange={(e) => {
                            I(e.target.value);
                            C("");
                        }}
                    >
                        <option value="">No discount</option>
                        {data.promotions
                            .filter((p: Row) => p.active && !p.code)
                            .map((p: Row) => (
                                <option key={p.id} value={p.id}>
                                    {p.name}
                                </option>
                            ))}
                    </select>
                </Field>
                <Field label="Or enter a promo code">
                    <input
                        value={code}
                        onChange={(e) => {
                            C(e.target.value.toUpperCase());
                            I("");
                        }}
                    />
                </Field>
                {error && <p className="error">{error}</p>}
                <button className="primary full" disabled={busy}>
                    Apply
                </button>
            </form>
        </Modal>
    );
}
function RefundModal({
    order: o,
    data,
    close,
    save,
}: {
    order: Row;
    data: Row;
    close: () => void;
    save: (v: Row) => Promise<any>;
}) {
    const money = useMoney();
    const p = o.payment || data.payments.find((p: Row) => p.order_id === o.id),
        [v, S] = useState<Row>({
            key: key(),
            reason: "",
            approver_id: "",
            approval_pin: "",
            reference: "",
            external_confirmed: false,
        }),
        [busy, B] = useState(false),
        [error, E] = useState("");
    return (
        <Modal title={"Full refund · #" + o.id} close={close}>
            <form
                onSubmit={async (e) => {
                    e.preventDefault();
                    B(true);
                    try {
                        await save({
                            ...v,
                            approver_id: Number(v.approver_id),
                        });
                    } catch (e) {
                        E((e as Error).message);
                    } finally {
                        B(false);
                    }
                }}
            >
                <div className="payment-amount">
                    <span>Includes bill, tax and tips</span>
                    <strong>{money(p.amount_cents + p.tip_cents)}</strong>
                </div>
                <Field label="Reason">
                    <textarea
                        required
                        minLength={3}
                        value={v.reason}
                        onChange={(e) => S({ ...v, reason: e.target.value })}
                    />
                </Field>
                <Field label="Approving Manager or Admin">
                    <select
                        required
                        value={v.approver_id}
                        onChange={(e) =>
                            S({ ...v, approver_id: e.target.value })
                        }
                    >
                        <option value="">Select approver</option>
                        {data.employees
                            .filter(
                                (u: Row) =>
                                    u.active &&
                                    ["admin", "manager"].includes(u.role),
                            )
                            .map((u: Row) => (
                                <option key={u.id} value={u.id}>
                                    {u.name}
                                </option>
                            ))}
                    </select>
                </Field>
                <Field label="Approval PIN">
                    <input
                        required
                        type="password"
                        autoComplete="off"
                        value={v.approval_pin}
                        onChange={(e) =>
                            S({ ...v, approval_pin: e.target.value })
                        }
                    />
                </Field>
                {p.method === "card" && (
                    <>
                        <p className="instruction">
                            Return the full amount on{" "}
                            {
                                data.terminals.find(
                                    (t: Row) => t.id === p.terminal_id,
                                )?.name
                            }
                            .
                        </p>
                        <Field label="Refund reference">
                            <input
                                required
                                value={v.reference}
                                onChange={(e) =>
                                    S({ ...v, reference: e.target.value })
                                }
                            />
                        </Field>
                        <label className="check">
                            <input
                                type="checkbox"
                                required
                                checked={v.external_confirmed}
                                onChange={(e) =>
                                    S({
                                        ...v,
                                        external_confirmed: e.target.checked,
                                    })
                                }
                            />
                            The terminal approved the refund.
                        </label>
                    </>
                )}
                {error && <p className="error">{error}</p>}
                <button className="primary full" disabled={busy}>
                    Approve and record full refund
                </button>
            </form>
        </Modal>
    );
}
function Kitchen({
    data,
    refresh,
    setError,
}: {
    data: Row;
    refresh: () => Promise<any>;
    setError: (s: string) => void;
}) {
    const [filter, F] = useState("all"),
        [busy, B] = useState<number | null>(null);
    const setStatus = async (id: number, status: string) => {
        B(id);
        try {
            await api("/api/kitchen/" + id, { status });
            await refresh();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            B(null);
        }
    };
    return (
        <section>
            <div className="section-heading">
                <div>
                    <h2>
                        {data.settings.kitchen_output === "printer"
                            ? "Print tickets"
                            : "On the line"}
                    </h2>
                    <p className="muted">
                        Food orders and changes, as they arrive.
                    </p>
                </div>
                <div className="segmented">
                    {["all", "new", "completed"].map(
                        (s) => (
                            <button
                                key={s}
                                className={filter === s ? "selected" : ""}
                                onClick={() => F(s)}
                            >
                                {s}
                            </button>
                        ),
                    )}
                </div>
            </div>
            <div className="kitchen-grid">
                {data.tickets
                    .filter((t: Row) =>
                        filter === "completed"
                            ? t.status === "completed"
                            : t.status !== "completed" &&
                              (filter === "all" || t.status === filter),
                    )
                    .map((t: Row) => (
                        <article
                            key={t.id}
                            className={
                                "ticket " +
                                (t.kind !== "new" ? "ticket-alert" : "")
                            }
                        >
                            <div className="section-heading">
                                <h2>{t.label}</h2>
                                <Pill
                                    tone={
                                        t.kind !== "new"
                                            ? "danger"
                                            : t.status === "ready"
                                              ? "good"
                                              : "warm"
                                    }
                                >
                                    {t.kind !== "new"
                                        ? t.kind === "amended"
                                            ? "ITEM CHANGED"
                                            : "CANCELLED ITEMS"
                                        : t.status}
                                </Pill>
                            </div>
                            <p className="muted">
                                KOT #{t.id} · Order #{t.order_id}
                                <br />
                                {timestamp(
                                    t.created_at,
                                    data.settings.timezone,
                                )}
                            </p>
                            {t.items.map((i: Row, n: number) => (
                                <div className="ticket-item" key={n}>
                                    <span className="qty">{i.quantity}</span>
                                    <div>
                                        <strong>{i.name}</strong>
                                        <small>
                                            {i.configuration?.join(" · ")}
                                        </small>
                                        {i.notes && (
                                            <p className="kitchen-note">
                                                {i.notes}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {["printer", "both"].includes(
                                data.settings.kitchen_output,
                            ) && (
                                <a
                                    className="secondary full"
                                    href={"/kitchen-tickets/" + t.id + "/print"}
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    Print kitchen ticket
                                </a>
                            )}
                            {t.status !== "completed" && (
                                <button
                                    disabled={busy === t.id}
                                    className="primary full"
                                    onClick={() =>
                                        setStatus(
                                            t.id,
                                            t.kind !== "new"
                                                ? "acknowledged"
                                                : data.settings
                                                        .kitchen_output ===
                                                    "printer"
                                                  ? "completed"
                                                  : (
                                                        {
                                                            new: "preparing",
                                                            preparing: "ready",
                                                            ready: "completed",
                                                        } as Row
                                                    )[t.status],
                                        )
                                    }
                                >
                                    {t.kind !== "new"
                                        ? "Acknowledge change"
                                        : data.settings.kitchen_output ===
                                            "printer"
                                          ? "Confirm ticket printed"
                                          : (
                                                {
                                                    new: "Start preparing",
                                                    preparing: "Mark ready",
                                                    ready: "Complete ticket",
                                                } as Row
                                            )[t.status]}
                                </button>
                            )}
                        </article>
                    ))}
            </div>
            {!data.tickets.some((t: Row) => t.status !== "completed") && (
                <Empty text="The kitchen is clear. New food orders will appear here." />
            )}
        </section>
    );
}

function AmendModal({
    item,
    close,
    save,
}: {
    item: Row;
    close: () => void;
    save: (v: Row) => Promise<any>;
}) {
    const [v, S] = useState<Row>({
            quantity: item.quantity,
            notes: item.notes || "",
            reason: "",
        }),
        [error, E] = useState(""),
        [busy, B] = useState(false);
    return (
        <Modal title={"Edit " + item.name} close={close}>
            <form
                onSubmit={async (e) => {
                    e.preventDefault();
                    B(true);
                    try {
                        await save(v);
                    } catch (e) {
                        E((e as Error).message);
                    } finally {
                        B(false);
                    }
                }}
            >
                <p className="muted mb-4">
                    Changes to sent food create a clear kitchen amendment
                    ticket.
                </p>
                <Field label="Quantity">
                    <input
                        type="number"
                        required
                        min="1"
                        max="99"
                        value={v.quantity}
                        onChange={(e) =>
                            S({ ...v, quantity: Number(e.target.value) })
                        }
                    />
                </Field>
                <Field label="Kitchen instructions">
                    <textarea
                        value={v.notes}
                        onChange={(e) => S({ ...v, notes: e.target.value })}
                    />
                </Field>
                <Field label="Reason for change">
                    <input
                        required
                        minLength={3}
                        value={v.reason}
                        onChange={(e) => S({ ...v, reason: e.target.value })}
                    />
                </Field>
                {error && <p className="error">{error}</p>}
                <button disabled={busy} className="primary full">
                    Save changes
                </button>
            </form>
        </Modal>
    );
}
