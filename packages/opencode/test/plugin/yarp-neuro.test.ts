import { expect, test } from "bun:test"
import type { Model } from "@opencode-ai/sdk/v2"
import { YarpNeuroAuthPlugin, YarpNeuroModels, yarpNeuroFetch } from "@/plugin/yarp-neuro"

test("registers YarpNeuro with an API-key auth method", async () => {
  const plugin = await YarpNeuroAuthPlugin()
  expect(plugin.auth).toMatchObject({
    provider: "yarp-neuro",
    methods: [{ type: "api", label: "API key" }],
  })
})

test("discovers YarpNeuro models with the x-bf-vk header", async () => {
  const requests: Array<{ authorization: string | null; key: string | null; path: string }> = []
  using server = Bun.serve({
    port: 0,
    fetch(request) {
      requests.push({
        authorization: request.headers.get("authorization"),
        key: request.headers.get("x-bf-vk"),
        path: new URL(request.url).pathname,
      })
      return Response.json({
        data: [
          { id: "model-a" },
          { id: "vendor/exact-model" },
          { id: "invalid model" },
          { id: "__proto__" },
        ],
      })
    },
  })

  const models = await YarpNeuroModels.get("test-key", {}, async (input, init) => {
    const url = new URL(input)
    return fetch(`${server.url}${url.pathname}`, init)
  })

  expect(requests).toEqual([
    {
      authorization: null,
      key: "test-key",
      path: "/v1/models",
    },
  ])
  expect(Object.keys(models)).toEqual(["model-a", "vendor/exact-model"])
  expect(models["vendor/exact-model"] satisfies Model).toMatchObject({
    id: "vendor/exact-model",
    providerID: "yarp-neuro",
    name: "vendor/exact-model",
    api: {
      id: "vendor/exact-model",
      url: "https://neuro.deyna.xyz/v1",
      npm: "@ai-sdk/openai-compatible",
    },
  })
})

test("does not follow YarpNeuro discovery redirects with the API key", async () => {
  const destinationRequests: string[] = []
  using destination = Bun.serve({
    port: 0,
    fetch(request) {
      destinationRequests.push(request.headers.get("x-bf-vk") ?? "")
      return Response.json({ data: [] })
    },
  })
  using redirect = Bun.serve({
    port: 0,
    fetch() {
      return Response.redirect(`${destination.url}/v1/models`, 302)
    },
  })

  const models = await YarpNeuroModels.get("test-key", {}, async (input, init) => {
    const url = new URL(input)
    return fetch(`${redirect.url}${url.pathname}`, init)
  })
  expect(models).toEqual({})
  expect(destinationRequests).toEqual([])
})

test("keeps existing models when YarpNeuro discovery fails", async () => {
  const existing = await YarpNeuroModels.get("test-key", {}, async () =>
    Response.json({ data: [{ id: "existing-model" }] }),
  )
  const models = await YarpNeuroModels.get("test-key", existing, async () => new Response("unavailable", { status: 503 }))

  expect(models).toEqual(existing)
})

test("routes YarpNeuro model requests through x-bf-vk at runtime", async () => {
  const requests: Array<{ authorization: string | null; key: string | null }> = []
  using server = Bun.serve({
    port: 0,
    fetch(request) {
      requests.push({
        authorization: request.headers.get("authorization"),
        key: request.headers.get("x-bf-vk"),
      })
      return new Response("ok")
    },
  })

  const fetcher = yarpNeuroFetch(
    async () => ({
      type: "api" as const,
      key: "test-key",
    }),
    async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input)
      return fetch(`${server.url}${url.pathname}`, init)
    },
  )
  const request = new Request("https://neuro.deyna.xyz/v1/chat/completions", {
    headers: {
      Authorization: "Bearer should-not-be-sent",
    },
  })
  await fetcher(request)

  expect(requests).toEqual([{ authorization: null, key: "test-key" }])
})

test("never forwards Authorization when YarpNeuro auth is unavailable", async () => {
  const requests: Array<{ authorization: string | null; key: string | null }> = []
  using server = Bun.serve({
    port: 0,
    fetch(request) {
      requests.push({
        authorization: request.headers.get("authorization"),
        key: request.headers.get("x-bf-vk"),
      })
      return new Response("ok")
    },
  })

  let calls = 0
  const fetcher = yarpNeuroFetch(
    async () => {
      calls += 1
      return undefined
    },
    async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input)
      return fetch(`${server.url}${url.pathname}`, init)
    },
  )
  await fetcher(
    new Request("https://neuro.deyna.xyz/v1/chat/completions", {
      headers: {
        Authorization: "Bearer should-not-be-sent",
        "x-bf-vk": "stale-key",
      },
    }),
  )

  expect(requests).toEqual([{ authorization: null, key: null }])
  expect(calls).toBe(1)
})

test("does not follow YarpNeuro runtime redirects with the API key", async () => {
  const destinationRequests: string[] = []
  using destination = Bun.serve({
    port: 0,
    fetch(request) {
      destinationRequests.push(request.headers.get("x-bf-vk") ?? "")
      return new Response("ok")
    },
  })
  using redirect = Bun.serve({
    port: 0,
    fetch() {
      return Response.redirect(`${destination.url}/v1/chat/completions`, 302)
    },
  })

  const fetcher = yarpNeuroFetch(
    async () => ({
      type: "api" as const,
      key: "test-key",
    }),
    async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input)
      return fetch(`${redirect.url}${url.pathname}`, init)
    },
  )
  const response = await fetcher(new Request("https://neuro.deyna.xyz/v1/chat/completions"))

  expect(response.status).toBe(302)
  expect(destinationRequests).toEqual([])
})
