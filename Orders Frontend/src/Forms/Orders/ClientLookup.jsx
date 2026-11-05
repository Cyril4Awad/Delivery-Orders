import React, { useState } from "react";
import { MapPin, Phone, Search, User, Users, X } from "lucide-react";
import PickerDialog from "../../ui/PickerDialog";
import { searchClients } from "./ordersApi";

const CLIENT_SOURCE = {
    id: "clients",
    label: "Clients",
    searchPlaceholder: "Search by name or phone...",
    fetchPage: ({ page, pageSize, search }) => searchClients({ page, pageSize, search }),
    columns: [
        { key: "name", label: "Name", render: (c) => c.name?.trim() },
        { key: "phone1", label: "Phone 1", width: 140 },
        { key: "phone2", label: "Phone 2", width: 140 },
        { key: "address", label: "Address" },
    ],
};

const clientKey = (c) => `${c.loc}-${c.recID}`;

/*
 * Client field over tbl_Clients. Empty: a field that opens a paged picker dialog (search by
 * name or phone). Picked: a detail card - name, Phone 1 / Phone 2 and address,
 * one per line - with an "x" to change the client.
 */
export default function ClientLookup({ value, onChange, autoFocus, openOnMount = false }) {
    // openOnMount: arrived here from "Search existing client" - show the picker right away
    const [open, setOpen] = useState(openOnMount);

    if (value) {
        const phones = [value.phone1, value.phone2].filter((p) => p && p.trim());
        return (
            <div className="ord-client-card">
                <div className="ord-client-card-head">
                    <span className="ord-client-avatar"><User size={20} /></span>
                    <div className="ord-client-info">
                        <div className="ord-client-name is-lg">{value.name?.trim()}</div>
                    </div>
                    <button type="button" className="ds-btn ds-btn-icon" onClick={() => onChange(null)} aria-label="Change client" title="Change client">
                        <X size={16} />
                    </button>
                </div>
                <dl className="ord-client-details">
                    {phones.length === 0 && <Detail icon={Phone} label="Phone"><span className="ord-muted">No phone</span></Detail>}
                    {phones.map((p, i) => (
                        <Detail key={i} icon={Phone} label={phones.length > 1 ? `Phone ${i + 1}` : "Phone"}><span className="ord-num">{p}</span></Detail>
                    ))}
                    <Detail icon={MapPin} label="Address">
                        {value.address?.trim() || <span className="ord-muted">No address on file</span>}
                    </Detail>
                </dl>
            </div>
        );
    }

    return (
        <>
            <button type="button" className="ds-field ord-pick-field" onClick={() => setOpen(true)} autoFocus={autoFocus}>
                <Search size={16} className="ord-pick-icon" />
                <span>Choose a client...</span>
            </button>
            {open && (
                <PickerDialog
                    title="Choose a client"
                    subtitle="Search by name or phone, then click the client."
                    icon={Users}
                    sources={[CLIENT_SOURCE]}
                    rowKey={clientKey}
                    onConfirm={([c]) => { setOpen(false); onChange(c); }}
                    onClose={() => setOpen(false)}
                />
            )}
        </>
    );
}

function Detail({ icon: Icon, label, children }) {
    return (
        <div className="ord-detail">
            <dt><Icon size={14} /> {label}</dt>
            <dd>{children}</dd>
        </div>
    );
}
