"use client";

import {
  memo,
  startTransition,
  useDeferredValue,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemCheck,
  ComboboxList,
  ComboboxPopover,
  ComboboxProvider,
  ComboboxSelect,
  ComboboxSelectArrow,
} from "@ariakit/react";
import { matchSorter } from "match-sorter";
import styles from "./Select.module.css";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type SelectGroup = {
  label: string;
  options: SelectOption[];
};

type RenderLabel = (label: string, value: string) => ReactNode;

type SelectProps = {
  id?: string;
  "aria-label"?: string;
  value: string;
  selectedLabel?: string;
  renderLabel?: RenderLabel;
  onChange: (value: string) => void;
  onReselect?: () => void;
  options: (SelectOption | SelectGroup)[];
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  className?: string;
};

export default function Select({
  id,
  "aria-label": ariaLabel,
  value,
  selectedLabel,
  renderLabel,
  onChange,
  onReselect,
  options,
  disabled = false,
  searchable = false,
  searchPlaceholder = "Search…",
  className = "",
}: SelectProps) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const isOpen = open && !disabled;
  // A searchable list can have hundreds of options. They mount in a background
  // render after the list opens and unmount the same way after it closes, so
  // neither waits for them.
  const deferredOpen = useDeferredValue(isOpen);
  const showOptions = deferredOpen || !searchable;
  const allOptions = useMemo(
    () =>
      options.flatMap((option) =>
        "options" in option ? option.options : [option],
      ),
    [options],
  );
  const matches = useMemo(
    () => new Set(matchSorter(allOptions, search, { keys: ["label"] })),
    [allOptions, search],
  );
  const label =
    allOptions.find((option) => option.value === value)?.label ??
    selectedLabel ??
    value;

  const renderOption = (option: SelectOption) => (
    <Option
      key={option.value}
      option={option}
      selected={option.value === value}
      renderLabel={renderLabel}
      onReselect={onReselect}
    />
  );

  return (
    <ComboboxProvider
      selectedValue={value}
      setSelectedValue={onChange}
      // Filtering is a transition, so typing doesn't wait for the list.
      setValue={(newSearch) => startTransition(() => setSearch(newSearch))}
      resetValueOnHide
      open={isOpen}
      setOpen={setOpen}
      placement="bottom-start"
    >
      <ComboboxSelect
        id={id}
        aria-label={ariaLabel}
        disabled={disabled}
        className={`${styles.Trigger} ${className}`}
        data-select=""
        value={value}
        // Keys meant for the dropdown stay away from the editor's shortcuts.
        // Escape still reaches a dialog around the closed button.
        onKeyDown={(event) => {
          if (event.key !== "Escape") event.stopPropagation();
        }}
      >
        <span className={styles.Value}>
          {renderLabel ? renderLabel(label, value) : label}
        </span>
        <ComboboxSelectArrow className={styles.Arrow} />
      </ComboboxSelect>
      <ComboboxPopover
        portal
        fixed
        gutter={4}
        data-searchable={searchable || undefined}
        data-loading={(isOpen && !showOptions) || undefined}
        className={styles.Popover}
        // Cancels the Escape that closes the list, so a modal dialog around it
        // doesn't also get a request to close. Closing here as well covers the
        // listener order inside a dialog, where Ariakit wouldn't.
        hideOnEscape={(event) => {
          event.preventDefault();
          setOpen(false);
          return true;
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {searchable ? (
          <div className={styles.Search}>
            <ComboboxInput
              autoSelect
              aria-label={searchPlaceholder}
              placeholder={searchPlaceholder}
              className={styles.Input}
            />
          </div>
        ) : null}
        <ComboboxList className={styles.List}>
          {showOptions
            ? options.map((option) => {
                if (!("options" in option)) {
                  return matches.has(option) ? renderOption(option) : null;
                }
                const items = option.options.filter((item) =>
                  matches.has(item),
                );
                return items.length ? (
                  <ComboboxGroup key={option.label} className={styles.Group}>
                    <ComboboxGroupLabel className={styles.GroupLabel}>
                      {option.label}
                    </ComboboxGroupLabel>
                    {items.map(renderOption)}
                  </ComboboxGroup>
                ) : null;
              })
            : null}
          {showOptions && !matches.size ? (
            <div className={styles.Empty} role="status">
              No matches found
            </div>
          ) : null}
        </ComboboxList>
      </ComboboxPopover>
    </ComboboxProvider>
  );
}

type OptionProps = {
  option: SelectOption;
  selected: boolean;
  renderLabel?: RenderLabel;
  onReselect?: () => void;
};

// Memoized, so typing a search re-renders only the options it adds or removes.
const Option = memo(function Option({
  option,
  selected,
  renderLabel,
  onReselect,
}: OptionProps) {
  return (
    <ComboboxItem
      value={option.value}
      disabled={option.disabled}
      className={styles.Item}
      data-value={option.value}
      onClick={() => {
        if (!option.disabled && selected) onReselect?.();
      }}
    >
      <ComboboxItemCheck className={styles.Check} />
      <span>
        {renderLabel ? renderLabel(option.label, option.value) : option.label}
      </span>
    </ComboboxItem>
  );
});
