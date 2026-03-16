import React from "react"
import { createRoot } from "react-dom/client"
import DashboardApp from "./DashboardApp"
import "./index.css"

const root = document.getElementById("root")!
createRoot(root).render(
  <React.StrictMode>
    <DashboardApp />
  </React.StrictMode>
)
