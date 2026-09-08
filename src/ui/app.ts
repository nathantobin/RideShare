import { loadData, saveData, type StorageLike } from "../core/storage";
import { emptyData } from "../core/trips";
import type { AppData, Trip } from "../core/types";
import { ValidationError } from "../core/types";
import type { ViewContext } from "./context";
import { renderDashboard, wireDashboard } from "./dashboard";
import { $ } from "./dom";
import { hashFor, parseHash, sameRoute, type Route } from "./router";
import { TripView } from "./trip-view";

/**
 * The shell: owns the data, persists it, and swaps between the dashboard and
 * a single trip's page based on the URL hash.
 */
export class App implements ViewContext {
  private state: AppData = emptyData();
  private route: Route = { name: "dashboard" };
  private tripView = new TripView(this);
  private errorTimer: number | undefined;

  constructor(private root: HTMLElement, private storage: StorageLike) {}

  start(): void {
    this.state = loadData(this.storage);
    this.route = parseHash(window.location.hash);
    window.addEventListener("hashchange", () => {
      this.route = parseHash(window.location.hash);
      this.render();
    });
    this.render();
  }

  // ---------------------------------------------------------------- context

  get data(): AppData {
    return this.state;
  }

  setData(data: AppData): void {
    this.state = data;
  }

  commit(change: () => void, after?: () => void): boolean {
    try {
      change();
    } catch (error) {
      if (error instanceof ValidationError) {
        this.showError(error.message);
        return false;
      }
      throw error;
    }
    saveData(this.storage, this.state);
    after?.();
    this.render();
    return true;
  }

  navigate(route: Route): void {
    if (sameRoute(route, this.route)) {
      this.render();
      return;
    }
    // The hashchange listener re-renders once the URL updates.
    window.location.hash = hashFor(route);
  }

  showError(message: string): void {
    const banner = $("#error");
    if (!banner) return;
    banner.textContent = message;
    window.clearTimeout(this.errorTimer);
    this.errorTimer = window.setTimeout(() => {
      if (banner.textContent === message) banner.textContent = "";
    }, 6000);
  }

  // ---------------------------------------------------------------- render

  render(): void {
    const trip = this.currentTrip();
    if (this.route.name === "trip" && !trip) {
      // A stale link or a deleted trip: fall back rather than show nothing.
      this.navigate({ name: "dashboard" });
      return;
    }

    if (trip) {
      this.rememberActive(trip);
      this.root.innerHTML = this.tripView.render(trip);
      this.tripView.wire(trip);
    } else {
      this.root.innerHTML = renderDashboard(this);
      wireDashboard(this);
    }
  }

  private currentTrip(): Trip | null {
    const route = this.route;
    if (route.name !== "trip") return null;
    return this.state.trips.find((trip) => trip.id === route.tripId) ?? null;
  }

  /** Keep the last-opened trip in the saved data, for exports and future use. */
  private rememberActive(trip: Trip): void {
    if (this.state.activeTripId === trip.id) return;
    this.state.activeTripId = trip.id;
    saveData(this.storage, this.state);
  }
}
