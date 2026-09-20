import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Global } from "@opencode-ai/core/global"

describe("global paths", () => {
  test("uses the YNCode namespace only for the global config path", () => {
    expect(path.basename(Global.Path.config)).toBe("yncode")
    expect(path.basename(Global.Path.data)).toBe("opencode")
    expect(path.basename(Global.Path.cache)).toBe("opencode")
    expect(path.basename(Global.Path.state)).toBe("opencode")
    expect(path.basename(Global.Path.tmp)).toBe("opencode")
  })

  test("tmp path is under the system temp directory", () => {
    expect(Global.Path.tmp).toBe(path.join(os.tmpdir(), "opencode"))
    expect(Global.make().tmp).toBe(Global.Path.tmp)
  })

  test("tmp path is created on module load", async () => {
    expect((await fs.stat(Global.Path.tmp)).isDirectory()).toBe(true)
  })
})
