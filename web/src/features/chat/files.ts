/** Browser file helpers for the chat composer (image attachment queue). */

/** Anthropic caps a single vision image at ~25 MB; reject earlier. */
export const MAX_CHAT_IMAGE_BYTES = 25 * 1024 * 1024;

/** True when the file can be attached through `image.attach_bytes`. */
export function isImageFile(file: File): boolean {
  return typeof file.type === "string" && file.type.startsWith("image/");
}

/**
 * Read a file as raw base64 (no `data:` prefix) for `image.attach_bytes`.
 * Rejects oversized files with an actionable message instead of round-tripping
 * bytes the backend would refuse.
 */
export function fileToBase64(file: File): Promise<string> {
  if (file.size > MAX_CHAT_IMAGE_BYTES) {
    return Promise.reject(
      new Error(
        `${file.name || "image"} is larger than ${Math.round(
          MAX_CHAT_IMAGE_BYTES / (1024 * 1024),
        )} MB and cannot be attached.`,
      ),
    );
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name || "image"}.`));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      if (comma < 0 || !result.startsWith("data:")) {
        reject(new Error(`Could not read ${file.name || "image"} as an image.`));
        return;
      }
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

/** Pull every image file out of a clipboard/drop DataTransfer. */
export function imagesFromDataTransfer(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files: File[] = [];
  const seen = new Set<string>();
  const push = (file: File | null) => {
    if (!file || !isImageFile(file)) return;
    const key = `${file.name}\0${file.type}\0${file.size}\0${file.lastModified}`;
    if (seen.has(key)) return;
    seen.add(key);
    files.push(file);
  };
  if (data.items?.length) {
    for (let index = 0; index < data.items.length; index += 1) {
      const item = data.items[index];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        push(item.getAsFile());
      }
    }
  }
  if (data.files?.length) {
    for (let index = 0; index < data.files.length; index += 1) {
      push(data.files[index]);
    }
  }
  return files;
}

/** True when a drag payload may contain an image (for `dragover`). */
export function transferMayContainImage(data: DataTransfer | null): boolean {
  if (!data) return false;
  if (data.items?.length) {
    for (let index = 0; index < data.items.length; index += 1) {
      const item = data.items[index];
      if (item.kind === "file" && (!item.type || item.type.startsWith("image/"))) {
        return true;
      }
    }
  }
  if (data.types?.length) {
    return Array.from(data.types).includes("Files");
  }
  return false;
}
