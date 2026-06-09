import { createRoot } from "react-dom/client";
import App from "./App";
import { consumeSsoToken } from "./lib/auth";
import "./index.css";

// ADG Team Suite SSO bridge: if we arrived via /#sso=<token>, persist the
// token to localStorage and strip it from the URL before the app renders.
// (Lets a future Suite SSO drop in without changing the rest of the auth code.)
consumeSsoToken();

createRoot(document.getElementById("root")!).render(<App />);
