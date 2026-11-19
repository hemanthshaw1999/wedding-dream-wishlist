export function ownerReturnPath(value: unknown): string {
  return typeof value === "string" && /^\/owner\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
    ? value : "/owner";
}
