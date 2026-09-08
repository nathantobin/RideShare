import "./styles.css";
import { App } from "./ui/app";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing #app element");

new App(root, window.localStorage).start();
