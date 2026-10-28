/** Coordinates and safe reason only: never echo JSON containing credentials. */
export function jsonDiagnostic(text: string, error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const incomplete = /end of|unterminated/i.test(message);
  const coordinate = /line (\d+) column (\d+)/i.exec(message);
  const position = incomplete ? text.length : Math.min(text.length, Number(/position (\d+)/i.exec(message)?.[1] ?? 0));
  const prefix = text.slice(0, position);
  return {
    line: coordinate && !incomplete ? Number(coordinate[1]) : prefix.split("\n").length,
    column: coordinate && !incomplete ? Number(coordinate[2]) : position - prefix.lastIndexOf("\n"),
    reason: incomplete ? "incomplete" : /property name|double-quoted/i.test(message) ? "property" : /comma|','|':'|separator/i.test(message) ? "separator" : "syntax",
  } as const;
}
