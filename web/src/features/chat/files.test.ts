// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  fileToBase64,
  imagesFromDataTransfer,
  isImageFile,
  MAX_CHAT_IMAGE_BYTES,
} from "./files";

function fileFrom(text: string, type: string, name: string): File {
  return new File([text], name, { type });
}

describe("chat image files", () => {
  it("accepts only image mime types", () => {
    expect(isImageFile(fileFrom("x", "image/png", "a.png"))).toBe(true);
    expect(isImageFile(fileFrom("x", "text/plain", "a.txt"))).toBe(false);
  });

  it("reads raw base64 without the data-url prefix", async () => {
    const encoded = await fileToBase64(fileFrom("hi", "image/png", "a.png"));
    expect(encoded).toBe("aGk=");
  });

  it("rejects oversized files before reading them", async () => {
    const huge = new File(["x"], "huge.png", { type: "image/png" });
    Object.defineProperty(huge, "size", { value: MAX_CHAT_IMAGE_BYTES + 1 });
    await expect(fileToBase64(huge)).rejects.toThrow(/larger than/);
  });

  it("extracts images from a DataTransfer", () => {
    const png = fileFrom("x", "image/png", "a.png");
    const transfer = {
      items: [
        { kind: "file", type: "image/png", getAsFile: () => png },
        { kind: "string", type: "text/plain", getAsFile: () => null },
      ],
      files: [png],
    } as unknown as DataTransfer;
    expect(imagesFromDataTransfer(transfer)).toEqual([png]);
  });
});
