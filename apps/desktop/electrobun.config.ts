import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "Tatami",
		identifier: "dev.tatami.app",
		version: "0.1.0",
		urlSchemes: ["tatami"],
	},
	build: {
		bun: {
			entrypoint: "src-electrobun/bun/index.ts",
		},
		copy: {
			"dist-electrobun/index.html": "views/mainview/index.html",
			"dist-electrobun/assets": "views/mainview/assets",
			"native/tatami_jj_native.node": "native/tatami_jj_native.node",
		},
		watchIgnore: ["dist-electrobun/**"],
		mac: {
			bundleCEF: false,
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: false,
		},
	},
} satisfies ElectrobunConfig;
