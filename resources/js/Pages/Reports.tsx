import React, { useEffect, useState, useRef } from "react";
import { Row, api, useMoney, Stats, Field, Empty } from "./ui";
export default function Reports({ timezone }: { timezone: string }) {
    const money = useMoney();
    const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());
    const requestId = useRef(0);
    const [department, D] = useState("all");
    const [from, F] = useState(today),
        [to, T] = useState(today),
        [report, R] = useState<Row | null>(null),
        [error, E] = useState(""),
        [busy, B] = useState(false);
    const load = async () => {
        const id = ++requestId.current;
        B(true);
        E("");
        try {
            const result = await api(
                "/api/reports?" + new URLSearchParams({ from, to, department }),
            );
            if (id === requestId.current) R(result);
        } catch (e) {
            if (id === requestId.current) E((e as Error).message);
        } finally {
            if (id === requestId.current) B(false);
        }
    };
    useEffect(() => {
        load();
    }, [department]);
    const lines = (rows: Row[], columns: string[]) => (
        <div className="table-scroll">
            <table>
                <thead>
                    <tr>
                        {columns.map((c) => (
                            <th key={c}>{c.replace("_cents", "").replaceAll("_", " ")}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r, i) => (
                        <tr key={i}>
                            {columns.map((c) => (
                                <td key={c}>
                                    {c.endsWith("_cents")
                                        ? money(Number(r[c]))
                                        : r[c]}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
            {!rows.length && <Empty />}
        </div>
    );
    return (
        <section className="report-page">
            <div className="section-heading">
                <div>
                    <h2>Reports</h2>
                    <p className="muted">
                        Dates use {timezone}. Refunds belong to the day they
                        were processed.
                    </p>
                </div>
                {report && (
                    <a
                        className="secondary"
                        href={
                            "/api/reports?" +
                            new URLSearchParams({
                                from: report.from,
                                to: report.to,
                                format: "csv",
                                department: report.department,
                            })
                        }
                    >
                        Export CSV
                    </a>
                )}
            </div>
            <div className="department-switch" aria-label="Report department">
                {[
                    "all",
                    "restaurant",
                    "bar",
                    ...(report?.departments.legacy.orders ||
                    report?.departments.legacy.refund_cents
                        ? ["legacy"]
                        : []),
                ].map((d) => (
                    <button
                        key={d}
                        className={department === d ? "selected" : ""}
                        aria-pressed={department === d}
                        onClick={() => D(d)}
                    >
                        {d === "all"
                            ? "All · combined"
                            : d === "legacy"
                              ? "Unassigned"
                              : d === "bar"
                                ? "Bar"
                                : "Restaurant"}
                    </button>
                ))}
            </div>
            <form
                className="report-filter"
                onSubmit={(e) => {
                    e.preventDefault();
                    load();
                }}
            >
                <Field label="From">
                    <input
                        required
                        type="date"
                        value={from}
                        onChange={(e) => F(e.target.value)}
                    />
                </Field>
                <Field label="Through">
                    <input
                        required
                        type="date"
                        value={to}
                        onChange={(e) => T(e.target.value)}
                    />
                </Field>
                <button disabled={busy} className="primary">
                    {busy ? "Loading…" : "View reports"}
                </button>
            </form>
            {error && (
                <p className="error" role="alert">
                    {error}
                </p>
            )}
            {report && (
                <>
                    <div className="section-heading">
                        <h3>
                            {report.department === "all"
                                ? "Combined"
                                : report.department === "legacy"
                                  ? "Unassigned"
                                  : report.department === "bar"
                                    ? "Bar"
                                    : "Restaurant"}{" "}
                            · {report.from} to {report.to}
                        </h3>
                        <button
                            className="secondary print-report"
                            onClick={() => window.print()}
                        >
                            Print report
                        </button>
                    </div>
                    <p className="muted">
                        Mixed bills: discounts, tax, tips and rounding are
                        allocated by item value. Tips still belong to the
                        attending employee. Order counts may overlap. Older
                        unassigned sales are included in combined totals.
                    </p>
                    <Stats summary={report.summary} />
                    <div className="panel department-revenue">
                        <h3>
                            Revenue by department · after refunds, before tax
                            and tips
                        </h3>
                        {[
                            "restaurant",
                            "bar",
                            ...(report.departments.legacy.orders ||
                            report.departments.legacy.refund_cents
                                ? ["legacy"]
                                : []),
                        ].map((d) => (
                            <div className="revenue-row" key={d}>
                                <span>
                                    {d === "legacy"
                                        ? "Unassigned"
                                        : d === "bar"
                                          ? "Bar"
                                          : "Restaurant"}
                                </span>
                                <div className="revenue-track">
                                    <div
                                        style={{
                                            width: `${(Math.max(0, report.departments[d].net_cents) / Math.max(1, ...Object.values(report.departments).map((s: any) => Math.max(0, s.net_cents)))) * 100}%`,
                                        }}
                                    />
                                </div>
                                <strong>
                                    {money(report.departments[d].net_cents)}
                                </strong>
                            </div>
                        ))}
                    </div>
                    <div className="panel mb-6">
                        <h3>Sales and refunds</h3>
                        {Object.entries(report.summary)
                            .filter(([k]) => k.endsWith("_cents"))
                            .map(([k, v]) => (
                                <div className="metric-line" key={k}>
                                    <span>
                                        {k
                                            .replace("_cents", "")
                                            .replaceAll("_", " ")}
                                    </span>
                                    <strong>{money(Number(v))}</strong>
                                </div>
                            ))}
                    </div>
                    <h3 className="mb-3">Cashiers and tips</h3>
                    {lines(report.cashiers, [
                        "name",
                        "orders",
                        "net_cents",
                        "earned_tips_cents",
                    ])}
                    <h3 className="mb-3 mt-6">
                        Products — before discounts and tax adjustments
                    </h3>
                    {lines(report.products, [
                        "name",
                        "quantity",
                        "sales_cents",
                    ])}
                    <h3 className="mb-3 mt-6">Offers used on payments</h3>
                    {lines(report.promotions, [
                        "name",
                        "uses",
                        "discount_cents",
                    ])}
                    <h3 className="mb-3 mt-6">
                        Terminal collections less refunds
                    </h3>
                    {lines(report.terminals, ["name", "total_cents"])}
                    <h3 className="mb-3 mt-6">Reservations by start date</h3>
                    {lines(report.reservations, ["status", "count"])}
                </>
            )}
        </section>
    );
}
