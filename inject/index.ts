import { installRuntime, type IdleHubWindow } from "./runtime";

installRuntime(window as IdleHubWindow);
