import Electrobun, { Electroview } from "electrobun/view";
import type { AppRPC } from "../../src-electrobun/shared/rpc.ts";

const rpc = Electroview.defineRPC<AppRPC>({
	maxRequestTime: 120000,
	handlers: {
		requests: {},
		messages: {
			repoChanged: ({ repoPath, timestamp }) => {
				window.dispatchEvent(
					new CustomEvent("tatami:repo-changed", { detail: { repoPath, timestamp } }),
				);
			},
			openRepositoryRequested: () => {
				window.dispatchEvent(new CustomEvent("tatami:open-repository-requested"));
			},
			deepLink: ({ url }) => {
				window.dispatchEvent(new CustomEvent("tatami:deep-link", { detail: { url } }));
			},
		},
	},
});

const electrobun = new Electrobun.Electroview({ rpc });

export { electrobun };
export { rpc as appRpc };
