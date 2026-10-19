export type HoldingEvent = {
  id: string;
  kind: "earnings" | "macro";
  title: string;
  date: string;
  allDay: boolean;
  symbol: string | null;
  impact: string;
  source: string;
  note: string;
  exposure: {
    symbol: string;
    quantity: number;
    marketValue: number | null;
    weight: number | null;
  }[];
};
const escape = (v: string) =>
  v
    .replaceAll("\\", "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
const stamp = (v: string) =>
  new Date(v)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
function fold(line: string) {
  const lines: string[] = [];
  let current = "",
    bytes = 0;
  for (const ch of line) {
    const length = new TextEncoder().encode(ch).length;
    if (bytes + length > 75) {
      lines.push(current);
      current = " ";
      bytes = 1;
    }
    current += ch;
    bytes += length;
  }
  lines.push(current);
  return lines.join("\r\n");
}
export function exportEventCalendar(
  events: HoldingEvent[],
  reminder = false,
  now = new Date(),
) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OpenTerminal//Holding events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const e of events) {
    if (!/^[a-f0-9]{32}$/.test(e.id) || !Number.isFinite(Date.parse(e.date)))
      throw new Error("Invalid event.");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id}@openterminal.local`,
      `DTSTAMP:${stamp(now.toISOString())}`,
      `SUMMARY:${escape(e.title)}`,
      `DESCRIPTION:${escape(`${e.note}\nSource: ${e.source}\n${e.exposure.map((h) => `${h.symbol}: ${h.quantity} shares`).join("; ")}`)}`,
    );
    if (e.allDay) {
      const day = e.date.slice(0, 10),
        end = new Date(Date.parse(day) + 86400000).toISOString().slice(0, 10);
      lines.push(
        `DTSTART;VALUE=DATE:${day.replaceAll("-", "")}`,
        `DTEND;VALUE=DATE:${end.replaceAll("-", "")}`,
      );
    } else lines.push(`DTSTART:${stamp(e.date)}`);
    if (reminder)
      lines.push(
        "BEGIN:VALARM",
        "TRIGGER:-PT24H",
        "ACTION:DISPLAY",
        `DESCRIPTION:${escape(e.title)}`,
        "END:VALARM",
      );
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
