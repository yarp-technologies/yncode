import { describe, expect } from "bun:test"
import { Deferred, Duration, Effect, Ref } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { YarpNeuroPlugin } from "@opencode-ai/core/plugin/provider/yarp-neuro"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const providerID = ProviderV2.ID.make("yarp-neuro")
const integrationID = Integration.ID.make("yarp-neuro")

const addPlugin = Effect.fn(function* (http: HttpClient.HttpClient) {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make(plugin)
  const integration = yield* Integration.Service
  yield* YarpNeuroPlugin.effect(host).pipe(
    Effect.provideService(Integration.Service, integration),
    Effect.provideService(HttpClient.HttpClient, http),
  )
})

const response = (models: readonly string[], status = 200) =>
  new Response(status === 200 ? JSON.stringify({ data: models.map((id) => ({ id })) }) : "", {
    status,
    headers: { "content-type": "application/json" },
  })

describe("YarpNeuroPlugin", () => {
  it.effect("loads models at startup and refreshes them periodically with x-bf-vk", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const catalog = yield* Catalog.Service
      yield* credentials.create({
        integrationID,
        value: Credential.Key.make({ type: "key", key: "secret" }),
      })
      yield* catalog.transform((draft) => {
        draft.provider.update(providerID, (provider) => {
          provider.name = "YarpNeuro"
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://neuro.deyna.xyz/v1",
          }
        })
      })

      const requests = yield* Ref.make(0)
      const started = yield* Deferred.make<void>()
      const refreshed = yield* Deferred.make<void>()
      const headers: Array<Record<string, string>> = []
      const http = HttpClient.make((request) =>
        Effect.gen(function* () {
          const number = yield* Ref.updateAndGet(requests, (current) => current + 1)
          headers.push(request.headers)
          if (number === 1) yield* Deferred.succeed(started, undefined)
          if (number === 2) yield* Deferred.succeed(refreshed, undefined)
          return HttpClientResponse.fromWeb(request, response(number === 1 ? ["startup-model"] : ["refreshed-model"]))
        }),
      )

      yield* addPlugin(http)
      yield* Deferred.await(started)
      yield* Effect.yieldNow
      expect(yield* catalog.model.get(providerID, ModelV2.ID.make("startup-model"))).toMatchObject({
        capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
      })
      expect(yield* catalog.model.get(providerID, ModelV2.ID.make("refreshed-model"))).toBeUndefined()

      yield* TestClock.adjust(Duration.minutes(10))
      yield* Deferred.await(refreshed)
      expect(yield* catalog.model.get(providerID, ModelV2.ID.make("startup-model"))).toBeUndefined()
      expect(yield* catalog.model.get(providerID, ModelV2.ID.make("refreshed-model"))).toBeDefined()
      expect(headers).toHaveLength(2)
      for (const header of headers) {
        expect(header["x-bf-vk"]).toBe("secret")
        expect(header.authorization).toBeUndefined()
      }
    }),
  )

  it.effect("keeps the last successful model list when refresh fails", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const catalog = yield* Catalog.Service
      yield* credentials.create({
        integrationID,
        value: Credential.Key.make({ type: "key", key: "secret" }),
      })
      yield* catalog.transform((draft) => {
        draft.provider.update(providerID, (provider) => {
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://neuro.deyna.xyz/v1",
          }
        })
      })

      const requests = yield* Ref.make(0)
      const failed = yield* Deferred.make<void>()
      const http = HttpClient.make((request) =>
        Effect.gen(function* () {
          const number = yield* Ref.updateAndGet(requests, (current) => current + 1)
          if (number === 2) yield* Deferred.succeed(failed, undefined)
          return HttpClientResponse.fromWeb(request, response(["stable-model"], number === 2 ? 503 : 200))
        }),
      )

      yield* addPlugin(http)
      yield* Effect.yieldNow
      expect(yield* catalog.model.get(providerID, ModelV2.ID.make("stable-model"))).toBeDefined()
      yield* TestClock.adjust(Duration.minutes(10))
      yield* Deferred.await(failed)
      expect(yield* catalog.model.get(providerID, ModelV2.ID.make("stable-model"))).toBeDefined()
    }),
  )
})
