import type { Hooks } from "@opencode-ai/plugin"
import type { Auth, Model } from "@opencode-ai/sdk/v2"
import { Schema } from "effect"

export const YarpNeuroProviderID = "yarp-neuro"
export const YarpNeuroBaseURL = "https://neuro.deyna.xyz/v1"
const DEFAULT_ORIGIN = new URL(YarpNeuroBaseURL).origin
const API_KEY_HEADER = "x-bf-vk"
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/
const RESERVED_MODEL_IDS = new Set(["__proto__", "constructor", "prototype"])

const ModelsResponse = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
    }),
  ),
})

const decodeModelsResponse = Schema.decodeUnknownSync(ModelsResponse)

export async function YarpNeuroAuthPlugin(): Promise<Hooks> {
  return {
    provider: {
      id: YarpNeuroProviderID,
      async models(provider, ctx) {
        if (ctx.auth?.type !== "api") return {}

        return YarpNeuroModels.get(ctx.auth.key, provider.models).catch((error) => {
          if (!(error instanceof Error)) throw error
          return provider.models
        })
      },
    },
    auth: {
      provider: YarpNeuroProviderID,
      async loader(getAuth) {
        const info = await getAuth()
        if (!info || info.type !== "api") return {}

        return {
          apiKey: "",
          fetch: yarpNeuroFetch(getAuth),
        }
      },
      methods: [
        {
          type: "api",
          label: "API key",
        },
      ],
    },
  }
}

type ModelsFetcher = (input: string, init?: RequestInit) => Promise<Response>

async function getModels(apiKey: string, existing: Record<string, Model>, request: ModelsFetcher = fetch) {
  const data = await request(`${YarpNeuroBaseURL}/models`, {
    headers: {
      [API_KEY_HEADER]: apiKey,
    },
    redirect: "manual",
    signal: AbortSignal.timeout(3_000),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Failed to fetch YarpNeuro models: ${response.status}`)
      return decodeModelsResponse(await response.json())
    })
    .catch((error) => {
      if (!(error instanceof Error)) throw error
      return undefined
    })
  if (!data) return existing

  return Object.fromEntries(
    data.data.filter((item) => isUsableModelID(item.id)).map((item) => {
      const template = Object.hasOwn(existing, item.id) ? existing[item.id] : undefined
      const model: Model = {
        id: item.id,
        providerID: YarpNeuroProviderID,
        name: template?.name ?? item.id,
        family: template?.family,
        api: {
          id: item.id,
          url: YarpNeuroBaseURL,
          npm: template?.api.npm ?? "@ai-sdk/openai-compatible",
        },
        status: template?.status ?? "active",
        headers: { ...template?.headers },
        options: { ...template?.options },
        cost: {
          input: template?.cost.input ?? 0,
          output: template?.cost.output ?? 0,
          cache: {
            read: template?.cost.cache.read ?? 0,
            write: template?.cost.cache.write ?? 0,
          },
        },
        limit: {
          context: template?.limit.context ?? 0,
          input: template?.limit.input,
          output: template?.limit.output ?? 0,
        },
        capabilities: {
          temperature: template?.capabilities.temperature ?? false,
          reasoning: template?.capabilities.reasoning ?? false,
          attachment: template?.capabilities.attachment ?? false,
          toolcall: template?.capabilities.toolcall ?? true,
          input: {
            text: template?.capabilities.input.text ?? true,
            audio: template?.capabilities.input.audio ?? false,
            image: template?.capabilities.input.image ?? false,
            video: template?.capabilities.input.video ?? false,
            pdf: template?.capabilities.input.pdf ?? false,
          },
          output: {
            text: template?.capabilities.output.text ?? true,
            audio: template?.capabilities.output.audio ?? false,
            image: template?.capabilities.output.image ?? false,
            video: template?.capabilities.output.video ?? false,
            pdf: template?.capabilities.output.pdf ?? false,
          },
          interleaved: template?.capabilities.interleaved ?? false,
        },
        release_date: template?.release_date ?? "",
      }
      if (template?.variants) model.variants = template.variants
      return [item.id, model]
    }),
  )
}

export const YarpNeuroModels = {
  get: getModels,
}

type RequestFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export function yarpNeuroFetch(getAuth: () => Promise<Auth | undefined>, request: RequestFetcher = fetch) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const current = await getAuth()
    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
    headers.delete("authorization")
    const url = new URL(input instanceof Request ? input.url : input)
    if (
      current?.type === "api" &&
      url.origin === DEFAULT_ORIGIN &&
      (url.pathname === "/v1" || url.pathname.startsWith("/v1/"))
    ) {
      headers.set(API_KEY_HEADER, current.key)
    } else {
      headers.delete(API_KEY_HEADER)
    }
    return request(input, { ...init, headers, redirect: "manual" })
  }
}

function isUsableModelID(id: string) {
  return MODEL_ID_PATTERN.test(id) && !RESERVED_MODEL_IDS.has(id)
}
