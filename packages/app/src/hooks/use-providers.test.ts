import { expect, test } from "bun:test"
import { popularProviders } from "./use-providers"

test("includes YarpNeuro in the popular provider catalog", () => {
  expect(popularProviders).toContain("yarp-neuro")
})
