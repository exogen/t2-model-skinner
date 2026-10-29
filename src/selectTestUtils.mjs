import { act } from "react";

export async function openSelect(trigger) {
  await act(async () => trigger.click());
  return globalThis.document.getElementById(
    trigger.getAttribute("aria-controls"),
  );
}

export async function chooseOption(trigger, value) {
  const popup = await openSelect(trigger);
  const option = [...popup.querySelectorAll('[role="option"]')].find(
    (item) => item.dataset.value === value,
  );
  if (!option) throw new Error(`Missing dropdown option: ${value}`);
  await act(async () => option.click());
}
