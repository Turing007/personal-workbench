function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function dateInputValue(value?: Date, fallbackNow: Date = new Date()): string {
  const date = value ?? fallbackNow;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dateOnlyValue(value: string): string {
  return value.trim().slice(0, 10);
}
