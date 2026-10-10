"use client";

import Link from "next/link";
import {
  isValidElement,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Download04Icon,
  Rocket01Icon,
  Settings02Icon,
} from "@hugeicons/core-free-icons";

export interface BranchedMenuChild {
  value: string;
  label: string;
  icon?: ReactNode | IconSvgElement;
  href?: string;
}
export interface BranchedMenuItem {
  label: string;
  value?: string;
  href?: string;
  children?: BranchedMenuChild[];
}
export interface BranchedMenuProps {
  items?: BranchedMenuItem[];
  defaultOpen?: number | number[];
  defaultActive?: string;
  activeValue?: string;
  onSelect?: (
    value: string,
    item: BranchedMenuChild | BranchedMenuItem,
  ) => void;
  onToggle?: (index: number, open: boolean) => void;
  color?: string;
  accentColor?: string;
  lineColor?: string;
  width?: number;
  rowHeight?: number;
  indent?: number;
  trunk?: number;
  radius?: number;
  lineWidth?: number;
  fontSize?: number;
  drawDuration?: number;
  foldDuration?: number;
  className?: string;
  "aria-label"?: string;
}
const DEFAULT_ITEMS: BranchedMenuItem[] = [
  {
    label: "Getting started",
    children: [
      { value: "install", label: "Installation", icon: Download04Icon },
      { value: "quick", label: "Quick start", icon: Rocket01Icon },
      { value: "config", label: "Configuration", icon: Settings02Icon },
    ],
  },
];
const PAD = 6;
const MARK = 16;
const toSet = (value: number | number[]) =>
  new Set(Array.isArray(value) ? value : value >= 0 ? [value] : []);

// Adapted from React Bits BranchedMenu: route links and controlled selection
// preserve browser navigation and keep the branch in sync with Next.js routes.
export default function BranchedMenu({
  items = DEFAULT_ITEMS,
  defaultOpen = 0,
  defaultActive = "",
  activeValue,
  onSelect,
  onToggle,
  color = "#f5f5f5",
  accentColor = "#f5f5f5",
  lineColor = "#3f3f46",
  width = 240,
  rowHeight = 36,
  indent = 40,
  trunk = 14,
  radius = 10,
  lineWidth = 1.5,
  fontSize = 14,
  drawDuration = 400,
  foldDuration = 300,
  className = "",
  "aria-label": ariaLabel = "Navigation",
}: BranchedMenuProps) {
  const [open, setOpen] = useState(() => toSet(defaultOpen));
  const [selected, setSelected] = useState(
    () =>
      defaultActive ||
      items.find((item, i) => item.children && toSet(defaultOpen).has(i))
        ?.children?.[0]?.value ||
      "",
  );
  const active = activeValue ?? selected;
  const navRef = useRef<HTMLElement>(null);
  const heads = useRef<(HTMLButtonElement | null)[]>([]);
  const markerRef = useRef<HTMLSpanElement>(null);
  const id = useId();
  const activeSection = items.findIndex((item) =>
    item.children?.some((child) => child.value === active),
  );
  const markerShown = activeSection >= 0 && open.has(activeSection);
  useLayoutEffect(() => {
    const place = (glide: boolean) => {
      const marker = markerRef.current;
      const head = heads.current[activeSection];
      if (!marker) return;
      if (!glide) marker.style.transition = "none";
      if (markerShown && head)
        marker.style.top = `${head.offsetTop + (head.offsetHeight - MARK) / 2}px`;
      marker.toggleAttribute("data-on", Boolean(markerShown && head));
      if (!glide) {
        void marker.offsetHeight;
        marker.style.transition = "";
      }
    };
    place(true);
    const observer = new ResizeObserver(() => place(false));
    if (navRef.current) observer.observe(navRef.current);
    return () => observer.disconnect();
  }, [activeSection, markerShown, items, fontSize, rowHeight]);
  const select = (
    value: string,
    item: BranchedMenuChild | BranchedMenuItem,
  ) => {
    setSelected(value);
    onSelect?.(value, item);
  };
  const toggle = (index: number) => {
    const next = new Set(open);
    const expanded = !next.has(index);
    if (expanded) next.add(index);
    else next.delete(index);
    setOpen(next);
    onToggle?.(index, expanded);
  };
  const r = Math.max(0, Math.min(radius, rowHeight / 2 - 2));
  const endX = indent - 8;
  const rowY = (k: number) => PAD + k * rowHeight + rowHeight / 2;
  const curve = (k: number) =>
    `A ${r} ${r} 0 0 0 ${trunk + r} ${rowY(k)} H ${endX}`;
  const reach = (k: number) => `M ${trunk} 0 V ${rowY(k) - r} ${curve(k)}`;
  const length = (k: number) =>
    rowY(k) - r + (Math.PI * r) / 2 + endX - trunk - r;
  const renderItem = (
    item: BranchedMenuChild | BranchedMenuItem,
    child: boolean,
    expanded = true,
  ) => {
    const value = item.value ?? item.label;
    const props = {
      className: child ? "bm-child" : "bm-head",
      "aria-current":
        value === active
          ? item.href
            ? ("page" as const)
            : ("true" as const)
          : undefined,
      "data-active": value === active ? "" : undefined,
      tabIndex: expanded ? 0 : -1,
      onClick: () => select(value, item),
    };
    const icon = "icon" in item ? item.icon : undefined;
    const content = (
      <>
        {icon ? (
          <span className="inline-flex flex-none" aria-hidden="true">
            {isValidElement(icon) ? (
              icon
            ) : (
              <HugeiconsIcon
                icon={icon as IconSvgElement}
                size={16}
                strokeWidth={1.8}
              />
            )}
          </span>
        ) : null}
        <span className="whitespace-nowrap">{item.label}</span>
      </>
    );
    return item.href ? (
      <Link href={item.href} {...props}>
        {content}
      </Link>
    ) : (
      <button type="button" {...props}>
        {content}
      </button>
    );
  };
  return (
    <nav
      ref={navRef}
      aria-label={ariaLabel}
      className={`branched-menu relative flex w-fit flex-col pl-3.5 leading-[1.2] ${className}`}
      style={
        {
          "--bm-w": `${width}px`,
          "--bm-ink": color,
          "--bm-accent": accentColor,
          "--bm-line": lineColor,
          "--bm-font": `${fontSize}px`,
          "--bm-row": `${rowHeight}px`,
          "--bm-indent": `${indent}px`,
          "--bm-line-w": lineWidth,
          "--bm-draw": `${drawDuration}ms`,
          "--bm-fold": `${foldDuration}ms`,
          "--bm-muted": `color-mix(in srgb, ${color} 55%, transparent)`,
        } as CSSProperties
      }
    >
      <span ref={markerRef} className="bm-marker" aria-hidden="true" />
      {items.map((item, i) => {
        const kids = item.children?.length ? item.children : undefined;
        const expanded = !!kids && open.has(i);
        const bodyH = kids ? PAD * 2 + kids.length * rowHeight : 0;
        return (
          <div
            key={item.value ?? item.label}
            className="flex flex-col"
            data-open={expanded ? "" : undefined}
          >
            {kids ? (
              <button
                ref={(el) => {
                  heads.current[i] = el;
                }}
                type="button"
                className="bm-head"
                aria-expanded={expanded}
                aria-controls={`${id}-${i}`}
                onClick={() => toggle(i)}
              >
                {item.label}
              </button>
            ) : (
              renderItem(item, false)
            )}
            {kids ? (
              <div id={`${id}-${i}`} className="bm-fold" inert={!expanded}>
                <div className="min-h-0 overflow-hidden">
                  <div
                    className="relative box-border py-1.5"
                    style={{ height: bodyH }}
                  >
                    <svg
                      className="bm-lines pointer-events-none absolute top-0 left-0 overflow-visible"
                      width={indent}
                      height={bodyH}
                      aria-hidden="true"
                    >
                      <path d={`M ${trunk} 0 V ${rowY(kids.length - 1) - r}`} />
                      {kids.map((kid, k) => (
                        <path
                          key={kid.value}
                          d={`M ${trunk} ${rowY(k) - r} ${curve(k)}`}
                        />
                      ))}
                      {kids.map((kid, k) => (
                        <path
                          key={kid.value}
                          className="bm-reach"
                          d={reach(k)}
                          style={{
                            strokeDasharray: length(k),
                            strokeDashoffset:
                              kid.value === active ? 0 : length(k),
                          }}
                        />
                      ))}
                    </svg>
                    {kids.map((kid) => (
                      <div key={kid.value}>
                        {renderItem(kid, true, expanded)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
