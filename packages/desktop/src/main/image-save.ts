import { writeFile } from "node:fs/promises"
import type { SaveDialogOptions, SaveDialogReturnValue, WebContents } from "electron"
import { decodeDataUrl, imageExtension, imageMime } from "./image-data"

type ShowSaveDialog = (options: SaveDialogOptions) => Promise<SaveDialogReturnValue>

export async function saveImageSource(source: string, webContents: WebContents, showSaveDialog: ShowSaveDialog) {
  const dataUrl = source.startsWith("data:") ? source : await resolveImageSource(source, webContents)
  const image = decodeDataUrl(dataUrl)
  if (!image) throw new Error("The image source cannot be saved")

  const mime = image.mime.startsWith("image/") ? image.mime : imageMime(image.bytes)
  if (!mime) throw new Error("The image source cannot be saved")

  const extension = imageExtension(mime)
  const result = await showSaveDialog({
    defaultPath: `image.${extension}`,
    filters: [{ name: mime, extensions: [extension] }],
  })
  if (result.canceled || !result.filePath) return

  await writeFile(result.filePath, image.bytes)
}

function resolveImageSource(source: string, webContents: WebContents) {
  return webContents
    .executeJavaScript(
      `fetch(${JSON.stringify(source)})
      .then((response) => {
        if (!response.ok) throw new Error(\`Failed to load image: \${response.status}\`)
        return response.blob()
      })
      .then((blob) => new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(reader.error?.message ?? "Failed to read image")
        reader.readAsDataURL(blob)
      }))`,
      true,
    )
    .then((value) => {
      if (typeof value !== "string") throw new Error("The image source did not produce image data")
      return value
    })
}
