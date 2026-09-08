/** Which screen the app is showing. */
export type Route =
  | { name: "dashboard" }
  | { name: "trip"; tripId: string };

/**
 * Routes live in the URL hash so the app stays a single static file: GitHub
 * Pages never sees the path, and the browser's back button still works.
 */
export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, "").trim();
  if (!path) return { name: "dashboard" };
  const [section, id] = path.split("/");
  if (section === "trip" && id) return { name: "trip", tripId: decodeURIComponent(id) };
  return { name: "dashboard" };
}

export function hashFor(route: Route): string {
  return route.name === "trip" ? `#/trip/${encodeURIComponent(route.tripId)}` : "#/";
}

export function sameRoute(a: Route, b: Route): boolean {
  return hashFor(a) === hashFor(b);
}
