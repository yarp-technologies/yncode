import { app } from "electron"

type Channel = "dev" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev"
export const UPDATER_ALLOW_PRERELEASE = import.meta.env.OPENCODE_ALLOW_PRERELEASE === "true"
export const UPDATER_CHANNEL = import.meta.env.OPENCODE_UPDATE_CHANNEL || "latest"
