import React from "react";
import { Modal, Pill, Row } from "./ui";

export default function TablePreview({ table, status, close }: {
    table: Row; status: string; close: () => void;
}) {
    const seats = Math.max(1, Math.min(50, Number(table.seats) || 1));
    const chairWidth = seats > 20 ? 20 : 34;
    return <Modal title={`${table.name} - Table preview`} close={close}>
        <div className="table-preview-details">
            <span>{table.area}</span>
            <strong>{seats} chairs</strong>
            <Pill tone={status === "available" ? "good" : status === "occupied" ? "warm" : "neutral"}>{status}</Pill>
        </div>
        <svg className="single-table-preview" viewBox="0 0 700 460" role="img" aria-label={`${table.name} with ${seats} chairs`}>
            <ellipse cx="350" cy="245" rx="235" ry="120" fill="#e8e1d7" />
            {Array.from({ length: seats }, (_, i) => {
                const angle = i * Math.PI * 2 / seats - Math.PI / 2;
                const x = 350 + Math.cos(angle) * 280;
                const y = 215 + Math.sin(angle) * 165;
                return <g key={i} data-chair="true" transform={`translate(${x},${y}) rotate(${angle * 180 / Math.PI + 90})`}>
                    <rect x={-chairWidth / 2} y="-18" width={chairWidth} height="36" rx="6" fill="#baa38b" stroke="#7d6958" strokeWidth="2" />
                    <rect x={-chairWidth / 2 - 2} y="-24" width={chairWidth + 4} height="10" rx="4" fill="#705c4d" />
                </g>;
            })}
            <path d="M210 240v65M490 240v65M350 285v46" stroke="#70503a" strokeWidth="14" strokeLinecap="round" />
            <ellipse cx="350" cy="226" rx="205" ry="110" fill="#8e613e" />
            <ellipse cx="350" cy="210" rx="205" ry="110" fill="#d6af79" stroke="#b38a58" strokeWidth="3" />
            <ellipse cx="350" cy="210" rx="190" ry="96" fill="none" stroke="#e5c897" strokeWidth="2" />
            <text x="350" y="206" textAnchor="middle" fontSize="24" fontWeight="700" fill="#513b28">{table.name}</text>
            <text x="350" y="239" textAnchor="middle" fontSize="18" fill="#674d35">{seats} seats</text>
        </svg>
        <p className="muted">Chair count matches this table's configured seats. Shape and spacing are illustrative.</p>
        <div className="modal-actions"><button className="primary" onClick={close}>Close preview</button></div>
    </Modal>;
}
