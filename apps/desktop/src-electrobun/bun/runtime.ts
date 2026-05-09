import { Layer, ManagedRuntime } from "effect";
import { DesktopService } from "./services/DesktopService.ts";
import { JjNativeAddon } from "./services/JjNativeAddon.ts";
import { RepoService } from "./services/RepoService.ts";
import { StorageService } from "./services/StorageService.ts";

const RepoLive = RepoService.Live.pipe(Layer.provide(JjNativeAddon.Live));
const BackendLive = Layer.mergeAll(RepoLive, StorageService.Live, DesktopService.Live);

export const BackendRuntime = ManagedRuntime.make(BackendLive);
