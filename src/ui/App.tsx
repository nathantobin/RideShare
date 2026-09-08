import { useEffect, useState } from "preact/hooks";
import { Dashboard } from "./Dashboard";
import { hashFor, parseHash, type Route } from "./router";
import { TripPage } from "./TripPage";
import { useAppData, useError } from "./store";

/** The current route, kept in step with the URL hash. */
function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function navigate(route: Route): void {
  window.location.hash = hashFor(route);
}

export function App() {
  const data = useAppData();
  const route = useRoute();
  const error = useError();

  const trip = route.name === "trip"
    ? data.trips.find((candidate) => candidate.id === route.tripId) ?? null
    : null;
  const missing = route.name === "trip" && !trip;

  // A stale link or a deleted trip: fall back rather than show nothing.
  useEffect(() => { if (missing) navigate({ name: "dashboard" }); }, [missing]);

  return (
    <>
      {error && <div class="err">{error}</div>}
      {trip ? <TripPage trip={trip} /> : <Dashboard trips={data.trips} />}
    </>
  );
}
