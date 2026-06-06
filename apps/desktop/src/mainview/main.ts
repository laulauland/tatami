import "./app.css";

import { mount } from "svelte";
import App from "./App.svelte";

// React Grab element-to-source picker; dev-only, stripped from production builds.
if (import.meta.env.DEV) {
	import("./dev/react-grab.ts");
}

const target = document.getElementById("app");

if (!target) {
	throw new Error("Missing #app element");
}

mount(App, { target });
