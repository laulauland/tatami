import { ManagedRuntime } from "effect";
import { NativeClient } from "./services/NativeClient.ts";

export const FrontendRuntime = ManagedRuntime.make(NativeClient.Live);
