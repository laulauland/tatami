import Electrobun, { Electroview } from "electrobun/view";
import type { AppRPC } from "../../src-electrobun/shared/rpc.ts";

const rpc = Electroview.defineRPC<AppRPC>({
	maxRequestTime: 5000,
	handlers: {
		requests: {},
		messages: {
			repoChanged: ({ timestamp }) => {
				window.dispatchEvent(new CustomEvent("tatami:repo-changed", { detail: { timestamp } }));
			},
		},
	},
});

const electrobun = new Electrobun.Electroview({ rpc });

export { electrobun };
export { rpc as appRpc };
