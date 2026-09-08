import { render } from "preact";
import "./styles.css";
import { App } from "./ui/App";
import { initStore } from "./ui/store";

const root = document.querySelector("#app");
if (!root) throw new Error("Missing #app element");

initStore(window.localStorage);
render(<App />, root);
