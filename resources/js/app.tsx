import "../css/app.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { createInertiaApp } from "@inertiajs/react";

createInertiaApp({
    title: (t) => (t ? `${t} · Forno POS` : "Forno POS"),
    resolve: async (name) =>
        name === "Login"
            ? (await import("./Pages/Login")).default
            : (await import("./Pages/Workspace")).default,
    setup({ el, App, props }) {
        createRoot(el).render(<App {...props} />);
    },
});
