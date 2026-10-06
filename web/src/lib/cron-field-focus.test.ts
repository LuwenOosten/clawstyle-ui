// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { focusCronField } from "./cron-job";

afterEach(() => { document.body.replaceChildren(); });
it("reveals a collapsed advanced section before focusing its invalid field", () => {
  const details = document.createElement("details");
  details.innerHTML = '<summary>Advanced</summary><input id="cron-script" />';
  document.body.append(details);
  expect(details.open).toBe(false);
  focusCronField("cron-script");
  expect(details.open).toBe(true);
  expect(document.activeElement).toBe(details.querySelector("input"));
});
