import { expect, test } from "bun:test"

test("embeds YarpNeuro updater settings in the main process bundle", async () => {
  const previous = {
    channel: process.env.OPENCODE_CHANNEL,
    updateChannel: process.env.OPENCODE_UPDATE_CHANNEL,
    allowPrerelease: process.env.OPENCODE_ALLOW_PRERELEASE,
  }
  process.env.OPENCODE_CHANNEL = "prod"
  process.env.OPENCODE_UPDATE_CHANNEL = "yarp"
  process.env.OPENCODE_ALLOW_PRERELEASE = "true"

  const module = await import("./electron.vite.config.ts")
  const define = module.default.main?.define

  if (previous.channel === undefined) delete process.env.OPENCODE_CHANNEL
  else process.env.OPENCODE_CHANNEL = previous.channel
  if (previous.updateChannel === undefined) delete process.env.OPENCODE_UPDATE_CHANNEL
  else process.env.OPENCODE_UPDATE_CHANNEL = previous.updateChannel
  if (previous.allowPrerelease === undefined) delete process.env.OPENCODE_ALLOW_PRERELEASE
  else process.env.OPENCODE_ALLOW_PRERELEASE = previous.allowPrerelease

  expect(define).toMatchObject({
    "import.meta.env.OPENCODE_CHANNEL": JSON.stringify("prod"),
    "import.meta.env.OPENCODE_UPDATE_CHANNEL": JSON.stringify("yarp"),
    "import.meta.env.OPENCODE_ALLOW_PRERELEASE": JSON.stringify("true"),
  })
})
