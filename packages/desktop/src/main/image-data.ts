export function decodeDataUrl(value: string) {
  if (!value.startsWith("data:")) return

  const separator = value.indexOf(",")
  if (separator === -1) return

  const metadata = value.slice("data:".length, separator)
  const body = value.slice(separator + 1)
  const [mime = "application/octet-stream", ...parameters] = metadata.split(";")
  const bytes = parameters.includes("base64")
    ? Buffer.from(body, "base64")
    : Buffer.from(decodeURIComponent(body), "utf8")

  return { mime, bytes }
}

export function imageExtension(mime: string) {
  return (
    {
      "image/bmp": "bmp",
      "image/gif": "gif",
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/svg+xml": "svg",
      "image/webp": "webp",
    }[mime.toLowerCase()] ?? "png"
  )
}
