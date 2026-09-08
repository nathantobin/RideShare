import type { AppData } from "../core/types";
import type { Route } from "./router";

/** What a view needs from the app shell to read state and change it. */
export interface ViewContext {
  readonly data: AppData;
  /** Replace everything, for import. Call inside `commit`. */
  setData(data: AppData): void;
  /** Apply a change, persist it, and re-render. False means it was rejected. */
  commit(change: () => void, after?: () => void): boolean;
  render(): void;
  navigate(route: Route): void;
  showError(message: string): void;
}
