// Dev-only integration for React Grab (https://github.com/aidenybai/react-grab):
// hover a UI element, press Cmd/Ctrl+C, and paste the source context into an agent.
//
// React Grab's built-in source resolution walks the React fiber tree, which a Svelte
// app does not have. element-source resolves the source location for our framework
// instead: its svelteResolver reads the `__svelte_meta` markers the Svelte compiler
// emits in dev builds. We feed that component stack back into whatever React Grab
// copies to the clipboard via the transformCopyContent hook.
//
// This module is imported only under `import.meta.env.DEV`, so it is stripped from
// production bundles and never reaches the packaged Electrobun app.
import {
	createSourceResolver,
	type ElementInfo,
	formatStack,
	svelteResolver,
} from "element-source";
import { init } from "react-grab/core";

const resolver = createSourceResolver({ resolvers: [svelteResolver] });

const resolveSvelteStack = async (element: Element): Promise<string | null> => {
	const info: ElementInfo = await resolver.resolveElementInfo(element);
	return info.stack.length > 0 ? formatStack(info.stack) : null;
};

// `init` from react-grab/core sets up the overlay without the auto-init telemetry
// ping that the default `import("react-grab")` entry point fires on load.
const grab = init({ telemetry: false });

grab.registerPlugin({
	name: "svelte-source",
	hooks: {
		transformCopyContent: async (content, elements) => {
			const stacks = (await Promise.all(elements.map(resolveSvelteStack))).filter(
				(stack): stack is string => stack !== null,
			);

			return stacks.length > 0
				? `${content}\n\nSvelte component stack:${stacks.join("")}`
				: content;
		},
	},
});
