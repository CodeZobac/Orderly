"use client";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { Kbd } from "./kbd";

export type SelectOption = {
  value: string;
  label: string;
  /** Group heading, e.g. the project a task belongs to. */
  group?: string;
  /** Secondary text shown after the label, e.g. currency or a status. */
  hint?: string;
  /** Extra words that should match while filtering. */
  keywords?: string;
  disabled?: boolean;
};

type Props = {
  options: SelectOption[];
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Shown when nothing is selected. */
  placeholder?: string;
  /** A selectable "empty" choice such as "All clients" (value ""). */
  emptyOption?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  /** Message when the filter matches nothing. */
  emptyMessage?: string;
};

/** Lowercases and strips diacritics so "analise" matches "Análise". */
export function normalize(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Every whitespace-separated term must appear somewhere in the haystack. */
export function matches(haystack: string, query: string) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const target = normalize(haystack);
  return terms.every((term) => target.includes(term));
}

/** Wraps the matched terms of `text` in <mark>, preserving original casing. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return <>{text}</>;
  const folded = normalize(text);
  // Normalization keeps one char per base letter for Latin text, so indexes line up.
  const marks = new Array<boolean>(text.length).fill(false);
  if (folded.length === text.length)
    for (const term of terms) {
      let at = folded.indexOf(term);
      while (at !== -1) {
        for (let i = at; i < at + term.length; i++) marks[i] = true;
        at = folded.indexOf(term, at + term.length);
      }
    }
  const parts: ReactNode[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i++)
    if (i === text.length || marks[i] !== marks[start]) {
      const chunk = text.slice(start, i);
      parts.push(marks[start] ? <mark key={start}>{chunk}</mark> : chunk);
      start = i;
    }
  return <>{parts}</>;
}

function filterOptions(options: SelectOption[], query: string) {
  return options.filter((option) =>
    matches(
      [option.label, option.group, option.hint, option.keywords]
        .filter(Boolean)
        .join(" "),
      query,
    ),
  );
}

type Position = {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
};

/**
 * Filterable select following the WAI-ARIA editable combobox pattern.
 * A hidden input carries `name`, so existing FormData submissions are unchanged.
 */
export function Select({
  options,
  name,
  value: controlled,
  defaultValue = "",
  onChange,
  placeholder = "Choose an option",
  emptyOption,
  required = false,
  disabled = false,
  id,
  "aria-label": ariaLabel,
  emptyMessage = "No matches",
}: Props) {
  const uid = useId();
  const listId = `${uid}-list`;
  const [internal, setInternal] = useState(defaultValue);
  const value = controlled ?? internal;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState<Position | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const hidden = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const all = useMemo(
    () =>
      emptyOption !== undefined
        ? [{ value: "", label: emptyOption }, ...options]
        : options,
    [emptyOption, options],
  );
  const selected = all.find((option) => option.value === value);
  const filtered = useMemo(() => filterOptions(all, query), [all, query]);

  const commit = useCallback(
    (next: string) => {
      if (controlled === undefined) setInternal(next);
      if (next !== value) onChange?.(next);
      setOpen(false);
      setQuery("");
    },
    [controlled, onChange, value],
  );

  // Required validation lives on the visible field so the browser points at it.
  useEffect(() => {
    input.current?.setCustomValidity(
      required && !value ? `${placeholder}.` : "",
    );
  }, [required, value, placeholder]);

  // Native form reset restores the initial choice, matching <select>.
  useEffect(() => {
    const form = hidden.current?.form;
    if (!form || controlled !== undefined) return;
    const reset = () => {
      setInternal(defaultValue);
      setQuery("");
      setOpen(false);
    };
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [controlled, defaultValue]);

  // Fixed positioning escapes scrolling dialog bodies; flip up when space is short.
  const place = useCallback(() => {
    const field = input.current?.getBoundingClientRect();
    if (!field) return;
    const below = window.innerHeight - field.bottom - 16;
    const above = field.top - 16;
    const up = below < 240 && above > below;
    setPosition({
      left: field.left,
      width: field.width,
      ...(up
        ? { bottom: window.innerHeight - field.top + 6 }
        : { top: field.bottom + 6 }),
      maxHeight: Math.max(160, Math.min(360, up ? above : below)),
    });
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  useLayoutEffect(() => {
    if (!open || active < 0) return;
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const enabledIndex = (from: number, step: 1 | -1) => {
    for (let i = from; i >= 0 && i < filtered.length; i += step)
      if (!filtered[i].disabled) return i;
    return -1;
  };
  const show = () => {
    if (disabled) return;
    setOpen(true);
    const current = filtered.findIndex((option) => option.value === value);
    setActive(current >= 0 ? current : enabledIndex(0, 1));
  };

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open || event.altKey) return show();
        setActive((i) => {
          const next = enabledIndex(i + 1, 1);
          return next >= 0 ? next : i < 0 ? enabledIndex(0, 1) : i;
        });
        return;
      case "ArrowUp":
        event.preventDefault();
        if (!open) return show();
        if (event.altKey) return setOpen(false);
        setActive((i) => {
          const next = enabledIndex(i - 1, -1);
          return next < 0 ? i : next;
        });
        return;
      case "Home":
      case "End":
        if (!open) return;
        event.preventDefault();
        setActive(
          event.key === "Home"
            ? enabledIndex(0, 1)
            : enabledIndex(filtered.length - 1, -1),
        );
        return;
      case "Enter":
        if (!open) return; // Closed: let the form submit as usual.
        event.preventDefault();
        if (filtered[active] && !filtered[active].disabled)
          commit(filtered[active].value);
        return;
      case "Escape":
        if (!open && !query) return; // Let dialogs handle Escape.
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        setQuery("");
        return;
      case "Tab":
        setOpen(false);
        setQuery("");
    }
  }

  return (
    <div className="select" data-open={open || undefined}>
      <input
        ref={input}
        id={id}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && active >= 0 ? `${uid}-opt-${active}` : undefined
        }
        aria-required={required || undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={open ? selected?.label || "Type to filter" : placeholder}
        value={open ? query : (selected?.label ?? "")}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          if (!open) setOpen(true);
          setActive(filterOptions(all, next).findIndex((o) => !o.disabled));
        }}
        onFocus={show}
        onClick={() => !open && show()}
        onBlur={() => {
          setOpen(false);
          setQuery("");
        }}
        onKeyDown={onKeyDown}
      />
      <span className="select-chevron" aria-hidden="true">
        <HugeiconsIcon icon={ArrowDown01Icon} size={18} strokeWidth={2} />
      </span>
      <input ref={hidden} type="hidden" name={name} value={value} />
      {open && position && (
        <div
          className="select-popover"
          style={{
            left: position.left,
            width: position.width,
            top: position.top,
            bottom: position.bottom,
            maxHeight: position.maxHeight,
          }}
          // Keep focus in the field while choosing with a pointer.
          onMouseDown={(event) => event.preventDefault()}
        >
          <div
            ref={list}
            id={listId}
            role="listbox"
            className="select-list"
            aria-label={ariaLabel}
          >
            {filtered.length === 0 && (
              <p className="select-empty" role="status">
                {emptyMessage} for “{query}”
              </p>
            )}
            {filtered.map((option, index) => {
              // Group headings appear once, before the first option of each group.
              const heading =
                option.group && option.group !== filtered[index - 1]?.group
                  ? option.group
                  : null;
              return (
                <Fragment key={`${option.value}-${index}`}>
                  {heading && (
                    <div className="select-group" role="presentation">
                      <Highlight text={heading} query={query} />
                    </div>
                  )}
                  <div
                    id={`${uid}-opt-${index}`}
                    data-index={index}
                    role="option"
                    className="select-option"
                    aria-selected={option.value === value}
                    aria-disabled={option.disabled || undefined}
                    data-active={index === active || undefined}
                    data-empty={option.value === "" || undefined}
                    onMouseMove={() =>
                      !option.disabled && index !== active && setActive(index)
                    }
                    onClick={() => !option.disabled && commit(option.value)}
                  >
                    <span className="select-check" aria-hidden="true">
                      {option.value === value && (
                        <HugeiconsIcon
                          icon={Tick02Icon}
                          size={16}
                          strokeWidth={2.2}
                        />
                      )}
                    </span>
                    <span className="select-label">
                      <Highlight text={option.label} query={query} />
                    </span>
                    {option.hint && (
                      <span className="select-hint">{option.hint}</span>
                    )}
                  </div>
                </Fragment>
              );
            })}
          </div>
          <div className="select-footer" aria-hidden="true">
            <span>
              {filtered.length} of {all.length}
            </span>
            <span>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> move <Kbd>Enter</Kbd> choose <Kbd>Esc</Kbd> close
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
