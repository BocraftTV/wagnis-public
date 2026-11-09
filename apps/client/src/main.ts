import { mount } from "svelte";
import "./styles/colors.css";
import "./styles/app.css";
import App from "./App.svelte";

mount(App, { target: document.getElementById("app")! });
