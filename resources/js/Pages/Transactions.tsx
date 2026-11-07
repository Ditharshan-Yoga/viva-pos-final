import React, { useEffect, useState } from "react";
import { Row, api, useMoney, timestamp, Field, Pill, Empty } from "./ui";
export default function Transactions({
    data,
    openOrder,
    refund,
}: {
    data: Row;
    openOrder: (id: number) => void;
    refund: (o: Row) => void;
}) {
    const money = useMoney();
    const [filters, F] = useState({ q: "", status: "all", from: "", to: "" }),
        [page, P] = useState(1),
        [result, R] = useState<Row | null>(null),
        [error, E] = useState("");
    const load = async (p = page) => {
        try {
            R(
                await api(
                    "/api/orders?" +
                        new URLSearchParams({ ...filters, page: String(p) }),
                ),
            );
            P(p);
            E("");
        } catch (e) {
            E((e as Error).message);
        }
    };
    useEffect(() => {
        load();
    }, [data.server_time]);
    return (
        <section>
            <div className="section-heading">
                <h2>Order history</h2>
                <Pill>{result?.total ?? 0} orders</Pill>
            </div>
            <form
                className="report-filter"
                onSubmit={(e) => {
                    e.preventDefault();
                    load(1);
                }}
            >
                <Field label="Order number or customer">
                    <input
                        value={filters.q}
                        onChange={(e) => F({ ...filters, q: e.target.value })}
                    />
                </Field>
                <Field label="Status">
                    <select
                        value={filters.status}
                        onChange={(e) =>
                            F({ ...filters, status: e.target.value })
                        }
                    >
                        {["all", "open", "paid", "refunded", "cancelled"].map(
                            (s) => (
                                <option key={s}>{s}</option>
                            ),
                        )}
                    </select>
                </Field>
                <Field label="From">
                    <input
                        type="date"
                        value={filters.from}
                        onChange={(e) =>
                            F({ ...filters, from: e.target.value })
                        }
                    />
                </Field>
                <Field label="Through">
                    <input
                        type="date"
                        value={filters.to}
                        onChange={(e) => F({ ...filters, to: e.target.value })}
                    />
                </Field>
                <button className="primary">Search</button>
            </form>
            {error && <p className="error">{error}</p>}
            <div className="table-scroll">
                <table>
                    <thead>
                        <tr>
                            <th>Order</th>
                            <th>Service</th>
                            <th>Attended by</th>
                            <th>Date</th>
                            <th>Bill</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {result?.data.map((o: Row) => (
                            <tr key={o.id}>
                                <td>
                                    #{o.id}
                                    <small>{o.customer_name}</small>
                                </td>
                                <td>
                                    {o.type === "takeout"
                                        ? "Takeout"
                                        : data.tables.find(
                                              (t: Row) =>
                                                  t.id === o.dining_table_id,
                                          )?.name}
                                </td>
                                <td>
                                    {
                                        data.employees.find(
                                            (u: Row) => u.id === o.attended_by,
                                        )?.name
                                    }
                                </td>
                                <td>
                                    {timestamp(
                                        o.created_at,
                                        data.settings.timezone,
                                    )}
                                </td>
                                <td>{money(o.total_cents)}</td>
                                <td>
                                    <Pill>{o.status}</Pill>
                                </td>
                                <td>
                                    <div className="button-row">
                                        {o.status === "open" ? (
                                            <button
                                                className="secondary"
                                                onClick={() => openOrder(o.id)}
                                            >
                                                Open
                                            </button>
                                        ) : (
                                            o.status !== "cancelled" && (
                                                <a
                                                    className="secondary"
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    href={"/receipts/" + o.id}
                                                >
                                                    Receipt
                                                </a>
                                            )
                                        )}
                                        {o.status === "paid" && (
                                            <button
                                                className="text-button danger-text"
                                                onClick={() => refund(o)}
                                            >
                                                Refund
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {!result?.data.length && (
                    <Empty text="No orders match this search." />
                )}
            </div>
            <div className="mt-4 flex items-center justify-between">
                <button
                    className="secondary"
                    disabled={page <= 1}
                    onClick={() => load(page - 1)}
                >
                    Previous
                </button>
                <span>
                    Page {page} of {result?.last_page || 1}
                </span>
                <button
                    className="secondary"
                    disabled={!result || page >= result.last_page}
                    onClick={() => load(page + 1)}
                >
                    Next
                </button>
            </div>
        </section>
    );
}
