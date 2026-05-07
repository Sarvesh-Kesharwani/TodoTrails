export const PLANNER_YEAR = 2026;

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const MONTH_SHORT_NAMES = MONTH_NAMES.map((name) => name.slice(0, 3));

export interface PlannerWeek {
  index: number;
  startDay: number;
  endDay: number;
  days: Date[];
}

export function clampPlannerDate(date: Date): Date {
  const year = date.getFullYear() === PLANNER_YEAR ? PLANNER_YEAR : PLANNER_YEAR;
  const month = date.getFullYear() === PLANNER_YEAR ? date.getMonth() : 0;
  const day = date.getFullYear() === PLANNER_YEAR ? date.getDate() : 1;
  return new Date(year, month, day);
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function endOfDay(date: Date): Date {
  const out = startOfLocalDay(date);
  out.setHours(23, 59, 59, 999);
  return out;
}

export function endOfMonth(year: number, month: number): Date {
  return endOfDay(new Date(year, month + 1, 0));
}

export function toDateKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function fromDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function sameLocalDay(a: Date, b: Date): boolean {
  return toDateKey(a) === toDateKey(b);
}

export function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getMonthWeeks(year: number, month: number): PlannerWeek[] {
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);
  const mondayOffset = (firstOfMonth.getDay() + 6) % 7;
  const start = new Date(firstOfMonth);
  start.setDate(firstOfMonth.getDate() - mondayOffset);

  const weeks: PlannerWeek[] = [];
  for (let cursor = new Date(start), index = 1; cursor <= lastOfMonth; index += 1) {
    const days = Array.from({ length: 7 }, (_, offset) => {
      const day = new Date(cursor);
      day.setDate(cursor.getDate() + offset);
      return day;
    });
    const monthDays = days.filter((day) => day.getMonth() === month);
    weeks.push({
      index,
      startDay: monthDays[0]?.getDate() ?? days[0].getDate(),
      endDay: monthDays[monthDays.length - 1]?.getDate() ?? days[6].getDate(),
      days,
    });
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

export function getWeekIndexForDate(date: Date): number {
  const weeks = getMonthWeeks(date.getFullYear(), date.getMonth());
  const key = toDateKey(date);
  return weeks.find((week) => week.days.some((day) => toDateKey(day) === key))?.index ?? 1;
}

export function getWeekForDate(date: Date): PlannerWeek {
  const week = getMonthWeeks(date.getFullYear(), date.getMonth()).find((item) => item.index === getWeekIndexForDate(date));
  return week ?? getMonthWeeks(date.getFullYear(), date.getMonth())[0];
}

export function dateInRange(date: Date, start: Date, end: Date): boolean {
  const time = startOfLocalDay(date).getTime();
  return time >= startOfLocalDay(start).getTime() && time <= startOfLocalDay(end).getTime();
}
