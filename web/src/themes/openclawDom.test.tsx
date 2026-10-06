// @vitest-environment jsdom
//
// The OpenClaw theme styles the Design System through stable class/role
// hooks (`button.text-display`, `button.shadow-midground`, the mono
// opt-outs, `role="radiogroup"`, …). Those hooks are the contract between
// `openclaw.css` and the DS DOM: if the DS changes the classes it emits,
// the theme silently stops applying. This guards the hooks themselves —
// it renders the real primitives and matches the selectors the stylesheet
// uses, without reading any CSS/source text.

import { afterEach, describe, expect, it } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

import { Button } from "@nous-research/ui/ui/components/button";
import { Input } from "@nous-research/ui/ui/components/input";
import { Label } from "@nous-research/ui/ui/components/label";
import { ListItem } from "@nous-research/ui/ui/components/list-item";
import { Segmented } from "@nous-research/ui/ui/components/segmented";
import { Select, SelectOption } from "@nous-research/ui/ui/components/select";

import { ConfirmDialog } from "@/components/ConfirmDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

async function render(node: ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(node));
}

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
});

const quoted = (selector: string) => `[class*="${selector}"]`;

describe("openclaw theme DOM hooks", () => {
  it("matches the DS button variants the stylesheet targets", async () => {
    await render(
      <>
        <Button data-testid="primary">Primary</Button>
        <Button data-testid="secondary" outlined>
          Secondary
        </Button>
        <Button data-testid="ghost" ghost>
          Ghost
        </Button>
        <Button data-testid="compact" size="sm">
          Compact
        </Button>
      </>,
    );

    const primary = container.querySelector<HTMLButtonElement>("[data-testid='primary']")!;
    const secondary = container.querySelector<HTMLButtonElement>("[data-testid='secondary']")!;
    const ghost = container.querySelector<HTMLButtonElement>("[data-testid='ghost']")!;
    const compact = container.querySelector<HTMLButtonElement>("[data-testid='compact']")!;

    expect(primary.matches(quoted("disabled:bg-midground/15"))).toBe(true);
    expect(primary.matches(quoted("py-[1.25em]"))).toBe(true);
    expect(primary.matches("button.bg-midground.text-background-base")).toBe(true);
    expect(secondary.matches(quoted("disabled:bg-midground/15"))).toBe(true);
    expect(secondary.matches("button.shadow-midground")).toBe(true);
    expect(secondary.matches("button.bg-midground.text-background-base")).toBe(false);
    expect(ghost.matches(quoted("disabled:bg-midground/15"))).toBe(true);
    expect(ghost.matches("button.shadow-midground")).toBe(false);
    // Compact keeps the 12px OpenClaw size hook and avoids the default padding.
    expect(compact.matches(quoted("text-[0.7rem]"))).toBe(true);
    expect(compact.matches(quoted("py-[1.25em]"))).toBe(false);
  });

  it("excludes mono opt-ins and the xterm helper textarea from field styling", async () => {
    await render(
      <>
        <Input data-testid="input" />
        <input data-testid="plain" />
        <input data-testid="schedule" className="font-courier" />
        <textarea data-testid="prose" />
        <textarea data-testid="code" className="font-courier" />
        <textarea data-testid="yaml" className="font-mono" />
        <textarea data-testid="xterm" className="xterm-helper-textarea" />
      </>,
    );

    const fieldSelector =
      "input:not([type='checkbox']):not(.font-mono):not(.font-courier)";
    const areaSelector =
      "textarea:not(.xterm-helper-textarea):not(.font-mono):not(.font-courier)";

    // The DS `Input` carries `font-courier` internally, so it is matched by
    // its positive field hook rather than the mono-opt-out exclusion.
    expect(
      container
        .querySelector("[data-testid='input']")!
        .matches(quoted("placeholder:text-midground/50")),
    ).toBe(true);
    expect(container.querySelector("[data-testid='plain']")!.matches(fieldSelector)).toBe(
      true,
    );
    expect(
      container.querySelector("[data-testid='schedule']")!.matches(fieldSelector),
    ).toBe(false);
    expect(container.querySelector("[data-testid='prose']")!.matches(areaSelector)).toBe(true);
    expect(container.querySelector("[data-testid='code']")!.matches(areaSelector)).toBe(false);
    expect(container.querySelector("[data-testid='yaml']")!.matches(areaSelector)).toBe(false);
    expect(container.querySelector("[data-testid='xterm']")!.matches(areaSelector)).toBe(false);
  });

  it("matches filter rows, segmented filters and labels", async () => {
    await render(
      <div>
        <Label data-testid="label">Schedule</Label>
        <ListItem data-testid="row">All categories</ListItem>
        <Segmented
          onChange={() => {}}
          options={[
            { label: "All", value: "all" },
            { label: "Active", value: "active" },
          ]}
          value="all"
        />
        <Select value="a" onValueChange={() => {}}>
          <SelectOption value="a">A</SelectOption>
        </Select>
      </div>,
    );

    expect(container.querySelector("label")).not.toBeNull();
    expect(
      container
        .querySelector("[data-testid='row']")!
        .matches("button.font-courier.text-left:not([role='combobox'])"),
    ).toBe(true);

    const group = container.querySelector("[role='radiogroup']")!;
    expect(group).not.toBeNull();
    const active = group.querySelector("[aria-checked='true']")!;
    expect(active.matches("button")).toBe(true);

    const combobox = container.querySelector("[role='combobox']")!;
    expect(combobox.matches("button[role='combobox']")).toBe(true);
    expect(
      combobox.matches("button.font-courier.text-left:not([role='combobox'])"),
    ).toBe(false);
  });

  it("renders confirmations through the shared modal shell", async () => {
    await render(
      <ConfirmDialog
        open
        onCancel={() => {}}
        onConfirm={() => {}}
        title="Reset defaults"
      />,
    );

    // The dashboard-owned modal frame (`@/ui/Modal`) carries its own radius
    // and surface rules, so the theme layer no longer patches a utility
    // chain here. Guard the contract other code/tests rely on.
    const shell = document.querySelector(
      "[role='dialog'][aria-modal='true'][data-ui-modal]",
    );
    expect(shell).not.toBeNull();
    expect(shell!.className).toContain("ui-modal");
    expect(document.querySelector('[data-ui-modal-overlay]')).not.toBeNull();
  });
});
