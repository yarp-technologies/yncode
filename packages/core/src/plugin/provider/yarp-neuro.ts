import { Duration, Effect, Schedule, Schema, Semaphore, Stream } from "effect"
import type { Scope } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { EventV2 } from "../../event"
import { Integration } from "../../integration"
import { ModelV2 } from "../../model"

const providerID = "yarp-neuro"
const integrationID = Integration.ID.make(providerID)
const baseURL = "https://neuro.deyna.xyz/v1"
const refreshInterval = Duration.minutes(10)
const modelIDPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/
const reservedModelIDs = new Set(["__proto__", "constructor", "prototype"])

const ModelsResponse = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
    }),
  ),
})

export const YarpNeuroPlugin = define<HttpClient.HttpClient | EventV2.Service | Scope.Scope>({
  id: providerID,
  effect: Effect.fn(function* (ctx) {
    const events = yield* EventV2.Service
    const http = yield* HttpClient.HttpClient
    const loading = Semaphore.makeUnsafe(1)
    let models = new Set<string>()

    yield* ctx.integration.transform((draft) => {
      draft.update(integrationID, (integration) => {
        integration.name = "YarpNeuro"
      })
      draft.method.update({
        integrationID,
        method: { type: "key", label: "API key" },
      })
    })

    yield* ctx.catalog.transform((catalog) => {
      catalog.provider.update(providerID, (provider) => {
        provider.integrationID = integrationID
        provider.name = "YarpNeuro"
        provider.api = {
          type: "aisdk",
          package: "@ai-sdk/openai-compatible",
          url: baseURL,
        }
      })
      const providerRecord = catalog.provider.get(providerID)
      for (const item of providerRecord?.models ?? []) {
        if (!models.has(item[0])) catalog.model.remove(providerID, item[0])
      }
      for (const modelID of models) {
        catalog.model.update(providerID, modelID, (model) => {
          model.name = modelID
          model.api = {
            id: ModelV2.ID.make(modelID),
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: baseURL,
          }
          model.capabilities = {
            tools: true,
            input: ["text"],
            output: ["text"],
          }
          model.status = "active"
          model.enabled = true
        })
      }
    })

    const refresh = Effect.fn("YarpNeuroPlugin.refresh")(function* () {
      const connection = yield* ctx.integration.connection.active(integrationID)
      if (!connection) return
      const credential = yield* ctx.integration.connection
        .resolve(connection)
        .pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (credential?.type !== "key") return
      const next = yield* fetchModels(http, credential.key).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("failed to load YarpNeuro models", { cause }).pipe(Effect.as(undefined)),
        ),
      )
      if (!next) return
      models = next
      yield* ctx.catalog.reload()
    })

    yield* events.subscribe(Integration.Event.ConnectionUpdated).pipe(
      Stream.filter((event) => event.data.integrationID === integrationID),
      Stream.runForEach(() => loading.withPermit(refresh())),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* loading
      .withPermit(refresh())
      .pipe(
        Effect.repeat(Schedule.spaced(refreshInterval)),
        Effect.ignore,
        Effect.forkScoped({ startImmediately: true }),
      )
  }),
})

function fetchModels(http: HttpClient.HttpClient, key: string) {
  return http
    .execute(
      HttpClientRequest.get(`${baseURL}/models`).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.setHeader("x-bf-vk", key),
      ),
    )
    .pipe(
      Effect.timeout("3 seconds"),
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(ModelsResponse)),
      Effect.map(
        (response) =>
          new Set(
            response.data.map((item) => item.id).filter((id) => modelIDPattern.test(id) && !reservedModelIDs.has(id)),
          ),
      ),
    )
}
