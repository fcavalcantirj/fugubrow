/**
 * Structured JSON logger for serverless runtime visibility.
 *
 * The app is otherwise near-silent, which made the "agent never finishes"
 * timeout impossible to see in Vercel logs. Every call emits one JSON line
 * (`scope`, `msg`, plus arbitrary fields) so runs can be traced and filtered
 * in Vercel's log explorer. This is the single sanctioned place for console.*.
 */

type Fields = Record<string, unknown>;

function emit(
  level: "info" | "warn" | "error",
  scope: string,
  msg: string,
  fields?: Fields,
): void {
  const line = JSON.stringify({ scope, msg, ...fields });
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    // eslint-disable-next-line no-console -- centralized structured logger; info goes to stdout for Vercel
    console.log(line);
  }
}

export const log = {
  info: (scope: string, msg: string, fields?: Fields) =>
    emit("info", scope, msg, fields),
  warn: (scope: string, msg: string, fields?: Fields) =>
    emit("warn", scope, msg, fields),
  error: (scope: string, msg: string, fields?: Fields) =>
    emit("error", scope, msg, fields),
};
