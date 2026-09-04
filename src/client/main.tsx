import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";
import { UiFeedbackProvider } from "./ui/feedback";

createRoot(document.getElementById("root")!).render(
  <UiFeedbackProvider>
    <App />
  </UiFeedbackProvider>,
);
