import { afterEach, expect, test, vi } from "vitest";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import Select from "./Select";
import { chooseOption, openSelect } from "./selectTestUtils.mjs";

const { document, window } = globalThis;
let root, host;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});

async function renderSelect(props = {}) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const onChange = vi.fn();
  function Field() {
    const [value, setValue] = useState("default/Base");
    return React.createElement(Select, {
      "aria-label": "Skin",
      value,
      searchable: true,
      searchPlaceholder: "Search skins…",
      options: [
        { value: "", label: "Select a skin…" },
        {
          label: "Default",
          options: [{ value: "default/Base", label: "Base" }],
        },
        {
          label: "Custom",
          options: [
            {
              value: "custom/Folder/Skin #1?100%",
              label: "Folder/Skin #1?100%",
            },
            { value: "loading", label: "Loading…", disabled: true },
          ],
        },
      ],
      onChange: (next) => {
        setValue(next);
        onChange(next);
      },
      ...props,
    });
  }
  await act(async () => root.render(React.createElement(Field)));
  return { trigger: host.querySelector("[data-select]"), onChange };
}

async function search(input, value) {
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

test("search filters labels and groups without changing the selected skin", async () => {
  const { trigger, onChange } = await renderSelect();
  const popup = await openSelect(trigger);
  await search(popup.querySelector("input"), "folder/skin");
  expect(
    [...popup.querySelectorAll('[role="option"]')].map(
      (item) => item.textContent,
    ),
  ).toEqual(["Folder/Skin #1?100%"]);
  expect(popup.querySelectorAll('[role="group"]')).toHaveLength(1);
  expect(trigger.textContent).toBe("Base");
  expect(onChange).not.toHaveBeenCalled();
  await act(async () => popup.querySelector('[role="option"]').click());
  expect(onChange).toHaveBeenCalledWith("custom/Folder/Skin #1?100%");
  expect(trigger.textContent).toBe("Folder/Skin #1?100%");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

test("an unmatched search offers feedback and is cleared on dismissal", async () => {
  const { trigger, onChange } = await renderSelect();
  const popup = await openSelect(trigger);
  const input = popup.querySelector("input");
  await search(input, "no such skin");
  expect(popup.querySelector('[role="status"]').textContent).toBe(
    "No matches found",
  );
  expect(popup.querySelector('[role="option"]')).toBeNull();
  await act(async () =>
    input.dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(onChange).not.toHaveBeenCalled();
  // Ariakit clears the query after the hidden popover finishes its lifecycle.
  await act(
    async () =>
      new Promise((resolve) =>
        globalThis.requestAnimationFrame(() =>
          globalThis.requestAnimationFrame(resolve),
        ),
      ),
  );
  const reopened = await openSelect(trigger);
  expect(reopened.querySelector("input").value).toBe("");
  expect(reopened.querySelectorAll('[role="option"]')).toHaveLength(4);
});

test("the empty choice clears a selection and disabled options cannot commit", async () => {
  const { trigger, onChange } = await renderSelect();
  const popup = await openSelect(trigger);
  await act(async () => popup.querySelector('[data-value="loading"]').click());
  expect(onChange).not.toHaveBeenCalled();
  await act(async () => popup.querySelector('[data-value=""]').click());
  expect(onChange).toHaveBeenCalledWith("");
  expect(trigger.textContent).toBe("Select a skin…");
});

test("standard dropdowns have no search input and select by value", async () => {
  const { trigger, onChange } = await renderSelect({ searchable: false });
  const popup = await openSelect(trigger);
  expect(popup.querySelector("input")).toBeNull();
  await act(async () => trigger.click());
  await chooseOption(trigger, "custom/Folder/Skin #1?100%");
  expect(onChange).toHaveBeenCalledWith("custom/Folder/Skin #1?100%");
});

test("disabled dropdowns stay closed", async () => {
  const { trigger, onChange } = await renderSelect({ disabled: true });
  await act(async () => trigger.click());
  expect(trigger.disabled).toBe(true);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(onChange).not.toHaveBeenCalled();
});
