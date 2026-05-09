import { Layer, ManagedRuntime } from "effect";
import { JjNativeAddon } from "./services/JjNativeAddon.ts";
import { RepoService } from "./services/RepoService.ts";

const BackendLive = RepoService.Live.pipe(Layer.provide(JjNativeAddon.Live));

export const BackendRuntime = ManagedRuntime.make(BackendLive);
