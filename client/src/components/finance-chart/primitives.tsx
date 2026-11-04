import * as React from "react";
import { CalendarDays, ChevronDown, Download } from "lucide-react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";
export const ChartCard = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>((p, r) => <div ref={r} {...p} />);
export function ChartButton({
  corner,
  ...p
}: React.ComponentProps<"button"> & { corner?: string }) {
  return (
    <button
      type="button"
      {...p}
      className={cn("finance-button", p.className)}
    />
  );
}
export const CalendarSolidIcon = CalendarDays,
  ChevronDownIcon = ChevronDown,
  DownloadIcon = Download;
export const ChartMenu = Menu.Root,
  ChartMenuTrigger = Menu.Trigger,
  ChartMenuRadioGroup = Menu.RadioGroup;
export function ChartMenuContent(p: React.ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        {...p}
        className={cn("finance-menu", p.className)}
        sideOffset={6}
      />
    </Menu.Portal>
  );
}
export function ChartMenuRadioItem(
  p: React.ComponentProps<typeof Menu.RadioItem>,
) {
  return <Menu.RadioItem {...p} className="finance-menu-item" />;
}
export function ChartSwatch(p: React.ComponentProps<"span">) {
  return <span {...p} />;
}
export function ChartTrend({
  value,
  locale = "en-US",
  fractionDigits = 2,
}: {
  value: number;
  locale?: string;
  fractionDigits?: number;
}) {
  return (
    <span className={value < 0 ? "finance-down" : "finance-up"}>
      {value < 0 ? "↓" : "↑"}{" "}
      {new Intl.NumberFormat(locale, {
        maximumFractionDigits: fractionDigits,
      }).format(Math.abs(value))}
      %
    </span>
  );
}
