import { afterEach, beforeEach, expect, test, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { getEnv } from "fabric";
import { Combobox, ComboboxItem, ComboboxList, ComboboxProvider } from "@ariakit/react";
import Dialog from "./Dialog";
import Select from "./Select";
import { openSelect } from "./selectTestUtils";

const { document, window } = getEnv();
let root;
let host;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function renderDialog(onClose) {
  await act(async () => root.render(React.createElement(Dialog, { title: "Photo strip", onClose },
    React.createElement(Select, {
      id: "Choice", value: "a", onChange: () => {}, options: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
    }))));
  return document.body.querySelector("dialog[open]");
}

const pressEscape = (target) => act(async () => {
  const event = new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
});
// jsdom doesn't turn an Escape into a close request, so the tests send one.
const requestClose = (dialog) => act(async () => {
  dialog.dispatchEvent(new window.Event("cancel", { cancelable: true }));
});
// Ariakit finishes hiding a dropdown after a frame.
const settle = () => act(async () => { await new Promise((resolve) => globalThis.setTimeout(resolve, 50)); });
// jsdom has no PointerEvent.
const press = (target, clientX, clientY) =>
  target.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, clientX, clientY }));
// A click goes to the element that holds both ends of the press: the dialog,
// when the pointer comes up on its backdrop.
const release = (dialog, clientX, clientY) =>
  dialog.dispatchEvent(new window.MouseEvent("click", { bubbles: true, clientX, clientY }));
// A click on the backdrop lands on the dialog element, outside its box.
const clickBackdrop = (dialog) => act(async () => {
  press(dialog, 5, 5);
  release(dialog, 5, 5);
});

test("a dropdown opened in a dialog is rendered inside it, where it can be clicked", async () => {
  const dialog = await renderDialog(vi.fn());
  const popup = await openSelect(dialog.querySelector("#Choice"));
  expect(dialog.contains(popup)).toBe(true);
});

test("escape in an open dropdown closes only the dropdown: the browser never gets a close request", async () => {
  const onClose = vi.fn();
  const dialog = await renderDialog(onClose);
  const trigger = dialog.querySelector("#Choice");
  for (let round = 0; round < 3; round++) {
    await openSelect(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const escape = await pressEscape(trigger);
    // A canceled Escape keydown isn't a close request.
    expect(escape.defaultPrevented).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await settle();
  }
  expect((await pressEscape(trigger)).defaultPrevented).toBe(false);
  await requestClose(dialog);
  expect(onClose).toHaveBeenCalledOnce();
});

test("a click outside an open dropdown closes only the dropdown, and the next one closes the dialog", async () => {
  const onClose = vi.fn();
  const dialog = await renderDialog(onClose);
  const trigger = dialog.querySelector("#Choice");
  await openSelect(trigger);
  await clickBackdrop(dialog);
  expect(onClose).not.toHaveBeenCalled();
  // In a browser that click closes the dropdown too.
  await pressEscape(trigger);
  await settle();
  await clickBackdrop(dialog);
  expect(onClose).toHaveBeenCalledOnce();
});

test("only a press and release both on the backdrop close the dialog, not a drag across its edge", async () => {
  const onClose = vi.fn();
  const dialog = await renderDialog(onClose);
  vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({ left: 100, top: 100, right: 500, bottom: 400 });
  await act(async () => {
    // Selecting the title's text, say, and letting go outside.
    press(dialog.querySelector("h2"), 150, 150);
    release(dialog, 50, 50);
    // From the dialog's own padding.
    press(dialog, 110, 110);
    release(dialog, 50, 50);
    // From the backdrop into the dialog.
    press(dialog, 50, 50);
    release(dialog, 150, 150);
  });
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => {
    press(dialog, 50, 50);
    release(dialog, 60, 40);
  });
  expect(onClose).toHaveBeenCalledOnce();
});

test("a list that's always shown isn't a dropdown: a click outside closes the dialog", async () => {
  const onClose = vi.fn();
  await act(async () => root.render(React.createElement(Dialog, { title: "Photo strip", onClose },
    React.createElement(ComboboxProvider, { open: true },
      React.createElement(Combobox, { "aria-label": "Search" }),
      React.createElement(ComboboxList, { alwaysVisible: true }, React.createElement(ComboboxItem, { value: "A" }))))));
  const dialog = document.body.querySelector("dialog[open]");
  expect(dialog.querySelector("[role='combobox']").getAttribute("aria-expanded")).toBe("true");
  await clickBackdrop(dialog);
  expect(onClose).toHaveBeenCalledOnce();
});
