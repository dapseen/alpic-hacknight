import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const gogBin = process.env.GOG_BIN ?? "gog";
const defaultAccount = process.env.GOG_ACCOUNT;
const maxBuffer = 10 * 1024 * 1024;

type JsonObject = Record<string, unknown>;

export type AssistantPeriod = "day" | "week";
export type GoogleSource = "gmail" | "calendar" | "tasks" | "drive" | "docs";

export type BriefTask = {
  id: string;
  title: string;
  due?: string;
  updated?: string;
  notes?: string;
  listId?: string;
  listTitle?: string;
  status: "needsAction" | "completed";
};

export type BriefEvent = {
  id: string;
  title: string;
  start?: string;
  end?: string;
  location?: string;
  status?: string;
  attendees: string[];
  link?: string;
};

export type PendingMessage = {
  threadId: string;
  messageId?: string;
  subject: string;
  from?: string;
  snippet?: string;
  date?: string;
  unread?: boolean;
};

export type DailyBrief = {
  period: AssistantPeriod;
  rangeStart: string;
  rangeEnd: string;
  tasks: BriefTask[];
  events: BriefEvent[];
  pendingMessages: PendingMessage[];
  warnings: string[];
};

export type ThreadMessage = {
  id: string;
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  date?: string;
  snippet?: string;
  body?: string;
};

export type ThreadDetail = {
  threadId: string;
  latestMessageId?: string;
  subject: string;
  snippet?: string;
  messages: ThreadMessage[];
  defaultTo: string[];
  defaultCc: string[];
};

export type DraftReplyDraft = {
  thread: ThreadDetail;
  suggestedReply: string;
  subject: string;
  relatedEvents: BriefEvent[];
  warnings: string[];
};

export type ContextResult = {
  source: GoogleSource;
  id: string;
  title: string;
  subtitle?: string;
  url?: string;
  when?: string;
  mimeType?: string;
};

export type SearchContextResponse = {
  query: string;
  results: ContextResult[];
  warnings: string[];
};

export type AvailabilitySlot = {
  start: string;
  end: string;
  label: string;
};

export type AvailabilityResponse = {
  rangeStart: string;
  rangeEnd: string;
  durationMinutes: number;
  candidateSlots: AvailabilitySlot[];
  busyBlocks: Array<{ start: string; end: string }>;
};

export type EventProposal = {
  proposedEvent: {
    calendarId: string;
    title: string;
    description?: string;
    location?: string;
    attendees: string[];
    durationMinutes: number;
    withMeet: boolean;
  };
  candidateSlots: AvailabilitySlot[];
  relatedContext: ContextResult[];
  warnings: string[];
};

export type SentReply = {
  success: true;
  messageId?: string;
  threadId?: string;
};

export type CreatedEvent = {
  success: true;
  eventId?: string;
  eventLink?: string;
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayFrom(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (isObject(value)) {
    for (const key of [
      "items",
      "results",
      "threads",
      "messages",
      "events",
      "files",
      "taskLists",
      "tasks",
      "calendars",
    ]) {
      const candidate = value[key];
      if (Array.isArray(candidate)) {
        return candidate;
      }
    }
  }

  return value == null ? [] : [value];
}

function stringFrom(value: unknown, ...keys: string[]): string | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return undefined;
}

function booleanFrom(value: unknown, ...keys: string[]): boolean | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "boolean") {
      return candidate;
    }
  }

  return undefined;
}

function nestedString(
  value: unknown,
  path: readonly [string, ...string[]],
): string | undefined {
  let current: unknown = value;
  for (const segment of path) {
    if (!isObject(current)) {
      return undefined;
    }
    current = current[segment];
  }

  return typeof current === "string" && current.trim().length > 0
    ? current
    : undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function runGogJson(
  args: string[],
  options?: { account?: string },
): Promise<unknown> {
  const fullArgs: string[] = [];

  const account = options?.account ?? defaultAccount;
  if (account) {
    fullArgs.push("--account", account);
  }

  fullArgs.push(...args, "--json", "--results-only", "--no-input");

  try {
    const { stdout, stderr } = await execFileAsync(gogBin, fullArgs, {
      env: process.env,
      maxBuffer,
    });

    if (!stdout.trim()) {
      return null;
    }

    try {
      return JSON.parse(stdout);
    } catch (error) {
      throw new Error(
        `gog returned invalid JSON for "${args.join(" ")}": ${
          stderr.trim() || toErrorMessage(error)
        }`,
      );
    }
  } catch (error) {
    throw new Error(`gog ${args.join(" ")} failed: ${toErrorMessage(error)}`);
  }
}

function buildRange(
  period: AssistantPeriod,
  referenceDate?: string,
): { start: string; end: string } {
  const base = referenceDate ? new Date(referenceDate) : new Date();

  if (Number.isNaN(base.getTime())) {
    throw new Error(`Invalid reference date: ${referenceDate}`);
  }

  const start = new Date(base);
  start.setHours(0, 0, 0, 0);

  if (period === "week") {
    const day = start.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + mondayOffset);
  }

  const end = new Date(start);
  end.setDate(end.getDate() + (period === "day" ? 1 : 7));

  return { start: start.toISOString(), end: end.toISOString() };
}

function normalizeTaskList(value: unknown): { id: string; title: string } | null {
  const id = stringFrom(value, "id");
  const title = stringFrom(value, "title", "name") ?? "Untitled task list";

  if (!id) {
    return null;
  }

  return { id, title };
}

function normalizeTask(
  value: unknown,
  list: { id: string; title: string },
): BriefTask | null {
  const id = stringFrom(value, "id");
  const title = stringFrom(value, "title", "name");

  if (!id || !title) {
    return null;
  }

  const status = stringFrom(value, "status") === "completed"
    ? "completed"
    : "needsAction";

  return {
    id,
    title,
    due: stringFrom(value, "due"),
    updated: stringFrom(value, "updated"),
    notes: stringFrom(value, "notes"),
    listId: list.id,
    listTitle: list.title,
    status,
  };
}

function normalizeEvent(value: unknown): BriefEvent | null {
  const id = stringFrom(value, "id");
  const title =
    stringFrom(value, "summary", "title", "name") ?? "Untitled event";

  if (!id) {
    return null;
  }

  const attendeesValue = isObject(value) ? value.attendees : undefined;
  const attendees = Array.isArray(attendeesValue)
    ? attendeesValue
        .map((attendee) =>
          stringFrom(attendee, "email", "displayName", "name"),
        )
        .filter((attendee): attendee is string => Boolean(attendee))
    : [];

  return {
    id,
    title,
    start:
      nestedString(value, ["start", "dateTime"]) ??
      nestedString(value, ["start", "date"]),
    end:
      nestedString(value, ["end", "dateTime"]) ??
      nestedString(value, ["end", "date"]),
    location: stringFrom(value, "location"),
    status: stringFrom(value, "status"),
    attendees,
    link: stringFrom(value, "htmlLink", "link"),
  };
}

function readGmailHeader(headers: unknown, headerName: string): string | undefined {
  if (!Array.isArray(headers)) {
    return undefined;
  }

  for (const header of headers) {
    if (!isObject(header)) {
      continue;
    }

    const name = stringFrom(header, "name");
    if (name?.toLowerCase() === headerName.toLowerCase()) {
      return stringFrom(header, "value");
    }
  }

  return undefined;
}

function decodeBase64Url(value: string): string | undefined {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const buffer = Buffer.from(padded, "base64");
    return buffer.toString("utf8");
  } catch {
    return undefined;
  }
}

function extractBodyText(payload: unknown): string | undefined {
  if (!isObject(payload)) {
    return undefined;
  }

  const inlineData = nestedString(payload, ["body", "data"]);
  if (inlineData) {
    return decodeBase64Url(inlineData);
  }

  const directBody = stringFrom(payload, "body");
  if (directBody) {
    return directBody;
  }

  const parts = payload.parts;
  if (!Array.isArray(parts)) {
    return undefined;
  }

  for (const part of parts) {
    const nested = extractBodyText(part);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function normalizePendingMessage(value: unknown): PendingMessage | null {
  const threadId = stringFrom(value, "threadId", "id");
  if (!threadId) {
    return null;
  }

  const payloadHeaders = isObject(value)
    ? nestedValue(value, "payload", "headers")
    : undefined;
  const labelIds = isObject(value) && Array.isArray(value.labelIds)
    ? value.labelIds
    : undefined;

  return {
    threadId,
    messageId: stringFrom(value, "id", "messageId"),
    subject:
      stringFrom(value, "subject") ??
      readGmailHeader(payloadHeaders, "Subject") ??
      "No subject",
    from:
      stringFrom(value, "from") ?? readGmailHeader(payloadHeaders, "From"),
    snippet: stringFrom(value, "snippet", "excerpt"),
    date:
      stringFrom(value, "date", "internalDate") ??
      readGmailHeader(payloadHeaders, "Date"),
    unread:
      booleanFrom(value, "unread") ??
      (Array.isArray(labelIds)
        ? labelIds.some((label: unknown) => label === "UNREAD")
        : undefined),
  };
}

function nestedValue(value: unknown, ...path: string[]): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (!isObject(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function extractEmailAddresses(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  return matches ?? [];
}

function normalizeThreadMessage(value: unknown): ThreadMessage | null {
  const id = stringFrom(value, "id");
  if (!id) {
    return null;
  }

  const payloadHeaders = nestedValue(value, "payload", "headers");

  return {
    id,
    from: readGmailHeader(payloadHeaders, "From") ?? stringFrom(value, "from"),
    to: readGmailHeader(payloadHeaders, "To") ?? stringFrom(value, "to"),
    cc: readGmailHeader(payloadHeaders, "Cc") ?? stringFrom(value, "cc"),
    subject:
      readGmailHeader(payloadHeaders, "Subject") ?? stringFrom(value, "subject"),
    date: readGmailHeader(payloadHeaders, "Date") ?? stringFrom(value, "date"),
    snippet: stringFrom(value, "snippet"),
    body:
      extractBodyText(nestedValue(value, "payload")) ?? stringFrom(value, "body"),
  };
}

function normalizeThread(value: unknown): ThreadDetail {
  const threadId = stringFrom(value, "id", "threadId") ?? "unknown-thread";
  const messages = arrayFrom(isObject(value) ? value.messages : undefined)
    .map(normalizeThreadMessage)
    .filter((message): message is ThreadMessage => Boolean(message));

  const latestMessage = messages.at(-1);
  const defaultTo = extractEmailAddresses(latestMessage?.from);
  const defaultCc = extractEmailAddresses(latestMessage?.cc);

  return {
    threadId,
    latestMessageId: latestMessage?.id,
    subject: latestMessage?.subject ?? stringFrom(value, "subject") ?? "No subject",
    snippet: latestMessage?.snippet ?? stringFrom(value, "snippet"),
    messages: messages.slice(-4),
    defaultTo,
    defaultCc,
  };
}

function normalizeDriveResult(value: unknown, source: GoogleSource): ContextResult | null {
  const id = stringFrom(value, "id");
  const title = stringFrom(value, "name", "title");

  if (!id || !title) {
    return null;
  }

  return {
    source,
    id,
    title,
    subtitle: stringFrom(value, "description"),
    url: stringFrom(value, "webViewLink", "alternateLink", "url"),
    mimeType: stringFrom(value, "mimeType"),
  };
}

function normalizeCalendarSearchResult(value: unknown): ContextResult | null {
  const event = normalizeEvent(value);
  if (!event) {
    return null;
  }

  return {
    source: "calendar",
    id: event.id,
    title: event.title,
    subtitle: event.location,
    url: event.link,
    when: event.start,
  };
}

function normalizeTaskSearchResult(value: BriefTask): ContextResult {
  return {
    source: "tasks",
    id: value.id,
    title: value.title,
    subtitle: value.listTitle,
    when: value.due,
  };
}

function sortByTime<T extends { due?: string; start?: string; date?: string }>(
  items: T[],
): T[] {
  return items.sort((left, right) => {
    const leftTime = left.due ?? left.start ?? left.date ?? "";
    const rightTime = right.due ?? right.start ?? right.date ?? "";
    return leftTime.localeCompare(rightTime);
  });
}

async function listTaskLists(): Promise<Array<{ id: string; title: string }>> {
  const raw = await runGogJson(["tasks", "lists", "list"]);
  return arrayFrom(raw)
    .map(normalizeTaskList)
    .filter((list): list is { id: string; title: string } => Boolean(list));
}

async function listTasksForList(
  list: { id: string; title: string },
  maxTasks: number,
): Promise<BriefTask[]> {
  const raw = await runGogJson([
    "tasks",
    "list",
    list.id,
    "--max",
    String(maxTasks),
  ]);

  return arrayFrom(raw)
    .map((task) => normalizeTask(task, list))
    .filter((task): task is BriefTask => Boolean(task));
}

async function listCalendarEvents(
  rangeStart: string,
  rangeEnd: string,
  maxEvents: number,
): Promise<BriefEvent[]> {
  const raw = await runGogJson([
    "calendar",
    "events",
    "primary",
    "--from",
    rangeStart,
    "--to",
    rangeEnd,
    "--max",
    String(maxEvents),
  ]);

  return arrayFrom(raw)
    .map(normalizeEvent)
    .filter((event): event is BriefEvent => Boolean(event));
}

async function searchUnreadMessages(
  period: AssistantPeriod,
  maxMessages: number,
): Promise<PendingMessage[]> {
  const query =
    period === "day"
      ? "in:inbox is:unread newer_than:14d"
      : "in:inbox is:unread newer_than:30d";

  const raw = await runGogJson([
    "gmail",
    "search",
    query,
    "--max",
    String(maxMessages),
  ]);

  return arrayFrom(raw)
    .map(normalizePendingMessage)
    .filter((message): message is PendingMessage => Boolean(message));
}

export async function getDailyBrief(input: {
  period: AssistantPeriod;
  referenceDate?: string;
  maxTasks?: number;
  maxEvents?: number;
  maxMessages?: number;
}): Promise<DailyBrief> {
  const { start, end } = buildRange(input.period, input.referenceDate);
  const warnings: string[] = [];

  const [taskListsResult, eventsResult, messagesResult] = await Promise.allSettled([
    listTaskLists(),
    listCalendarEvents(start, end, input.maxEvents ?? 8),
    searchUnreadMessages(input.period, input.maxMessages ?? 8),
  ]);

  let tasks: BriefTask[] = [];
  if (taskListsResult.status === "fulfilled") {
    const settledTasks = await Promise.allSettled(
      taskListsResult.value.map((list) =>
        listTasksForList(list, input.maxTasks ?? 15)
      ),
    );

    for (const settled of settledTasks) {
      if (settled.status === "fulfilled") {
        tasks.push(...settled.value);
      } else {
        warnings.push(toErrorMessage(settled.reason));
      }
    }
  } else {
    warnings.push(toErrorMessage(taskListsResult.reason));
  }

  const filteredTasks = sortByTime(
    tasks.filter((task) => task.status !== "completed"),
  ).slice(0, input.maxTasks ?? 12);

  const events =
    eventsResult.status === "fulfilled"
      ? sortByTime(eventsResult.value).slice(0, input.maxEvents ?? 8)
      : [];
  if (eventsResult.status === "rejected") {
    warnings.push(toErrorMessage(eventsResult.reason));
  }

  const pendingMessages =
    messagesResult.status === "fulfilled"
      ? sortByTime(messagesResult.value).slice(0, input.maxMessages ?? 8)
      : [];
  if (messagesResult.status === "rejected") {
    warnings.push(toErrorMessage(messagesResult.reason));
  }

  return {
    period: input.period,
    rangeStart: start,
    rangeEnd: end,
    tasks: filteredTasks,
    events,
    pendingMessages,
    warnings,
  };
}

async function loadThread(threadId: string): Promise<ThreadDetail> {
  const raw = await runGogJson(["gmail", "thread", "get", threadId, "--full"]);
  return normalizeThread(raw);
}

async function resolveThreadId(input: {
  threadId?: string;
  gmailQuery?: string;
  userRequest: string;
}): Promise<string> {
  if (input.threadId) {
    return input.threadId;
  }

  const raw = await runGogJson([
    "gmail",
    "search",
    input.gmailQuery ?? input.userRequest,
    "--max",
    "5",
  ]);

  const firstMatch = arrayFrom(raw)
    .map(normalizePendingMessage)
    .find((message) => Boolean(message));

  if (!firstMatch) {
    throw new Error("No matching Gmail thread found for this request.");
  }

  return firstMatch.threadId;
}

async function searchCalendarContext(query: string, maxResults = 4): Promise<BriefEvent[]> {
  const raw = await runGogJson([
    "calendar",
    "search",
    query,
    "--days",
    "14",
    "--max",
    String(maxResults),
  ]);

  return arrayFrom(raw)
    .map(normalizeEvent)
    .filter((event): event is BriefEvent => Boolean(event));
}

export async function prepareDraftReply(input: {
  userRequest: string;
  draftReply: string;
  gmailQuery?: string;
  threadId?: string;
  subject?: string;
  maxRelatedEvents?: number;
}): Promise<DraftReplyDraft> {
  const threadId = await resolveThreadId(input);
  const [thread, relatedEventsResult] = await Promise.all([
    loadThread(threadId),
    searchCalendarContext(input.userRequest, input.maxRelatedEvents ?? 4).catch(
      (error: unknown) => {
        return {
          error: toErrorMessage(error),
          items: [] as BriefEvent[],
        };
      },
    ),
  ]);

  const warnings: string[] = [];
  const relatedEvents = Array.isArray(relatedEventsResult)
    ? relatedEventsResult
    : relatedEventsResult.items;

  if (!Array.isArray(relatedEventsResult)) {
    warnings.push(relatedEventsResult.error);
  }

  return {
    thread,
    suggestedReply: input.draftReply,
    subject: input.subject ?? thread.subject,
    relatedEvents,
    warnings,
  };
}

export async function sendDraftReply(input: {
  threadId?: string;
  replyToMessageId?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  replyBody: string;
  replyAll?: boolean;
  quoteOriginal?: boolean;
}): Promise<SentReply> {
  const args = ["gmail", "send"];

  if (input.replyToMessageId) {
    args.push("--reply-to-message-id", input.replyToMessageId);
  }

  if (input.threadId) {
    args.push("--thread-id", input.threadId);
  }

  if (input.replyAll) {
    args.push("--reply-all");
  } else if (input.to?.length) {
    args.push("--to", input.to.join(","));
  } else {
    throw new Error("Either recipients or reply-all must be provided.");
  }

  if (input.cc?.length) {
    args.push("--cc", input.cc.join(","));
  }

  if (input.bcc?.length) {
    args.push("--bcc", input.bcc.join(","));
  }

  if (input.quoteOriginal) {
    args.push("--quote");
  }

  args.push("--subject", input.subject, "--body", input.replyBody);

  const raw = await runGogJson(args);

  return {
    success: true,
    messageId: stringFrom(raw, "id", "messageId"),
    threadId: stringFrom(raw, "threadId"),
  };
}

function resultTitleMatches(result: ContextResult, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }

  return [result.title, result.subtitle]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(needle));
}

async function searchTasksContext(query: string): Promise<ContextResult[]> {
  const lists = await listTaskLists();
  const allTasks = await Promise.all(lists.map((list) => listTasksForList(list, 25)));
  return allTasks
    .flat()
    .filter((task) => task.status !== "completed")
    .filter((task) => resultTitleMatches(normalizeTaskSearchResult(task), query))
    .slice(0, 5)
    .map(normalizeTaskSearchResult);
}

export async function searchGoogleContext(input: {
  query: string;
  sources: GoogleSource[];
}): Promise<SearchContextResponse> {
  const results: ContextResult[] = [];
  const warnings: string[] = [];

  const tasks = input.sources.map(async (source) => {
    try {
      switch (source) {
        case "gmail": {
          const raw = await runGogJson([
            "gmail",
            "search",
            input.query,
            "--max",
            "5",
          ]);
          return arrayFrom(raw)
            .map(normalizePendingMessage)
            .filter((message): message is PendingMessage => Boolean(message))
            .map<ContextResult>((message) => ({
              source: "gmail",
              id: message.threadId,
              title: message.subject,
              subtitle: message.from,
              when: message.date,
            }));
        }
        case "calendar": {
          const raw = await runGogJson([
            "calendar",
            "search",
            input.query,
            "--days",
            "30",
            "--max",
            "5",
          ]);
          return arrayFrom(raw)
            .map(normalizeCalendarSearchResult)
            .filter((result): result is ContextResult => Boolean(result));
        }
        case "tasks":
          return await searchTasksContext(input.query);
        case "drive": {
          const raw = await runGogJson([
            "drive",
            "search",
            input.query,
            "--max",
            "5",
          ]);
          return arrayFrom(raw)
            .map((value) => normalizeDriveResult(value, "drive"))
            .filter((result): result is ContextResult => Boolean(result));
        }
        case "docs": {
          const raw = await runGogJson([
            "drive",
            "search",
            input.query,
            "--max",
            "8",
          ]);
          return arrayFrom(raw)
            .map((value) => normalizeDriveResult(value, "docs"))
            .filter(
              (result): result is ContextResult =>
                result !== null &&
                (result.mimeType?.includes("document") ?? false),
            )
            .slice(0, 5);
        }
      }
    } catch (error) {
      warnings.push(`[${source}] ${toErrorMessage(error)}`);
      return [] as ContextResult[];
    }
  });

  for (const batch of await Promise.all(tasks)) {
    results.push(...batch);
  }

  return {
    query: input.query,
    results: results.slice(0, 20),
    warnings,
  };
}

function normalizeBusyBlocks(raw: unknown): Array<{ start: string; end: string }> {
  if (!isObject(raw)) {
    return [];
  }

  const calendarMap = isObject(raw.calendars) ? raw.calendars : raw;
  const busyBlocks: Array<{ start: string; end: string }> = [];

  for (const value of Object.values(calendarMap)) {
    if (!isObject(value)) {
      continue;
    }

    const busy = value.busy;
    if (!Array.isArray(busy)) {
      continue;
    }

    for (const block of busy) {
      const start = stringFrom(block, "start");
      const end = stringFrom(block, "end");
      if (start && end) {
        busyBlocks.push({ start, end });
      }
    }
  }

  return busyBlocks.sort((left, right) => left.start.localeCompare(right.start));
}

function formatSlotLabel(start: Date, end: Date): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });

  const endFormatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  return `${formatter.format(start)} - ${endFormatter.format(end)}`;
}

function roundUpToHalfHour(date: Date): Date {
  const rounded = new Date(date);
  rounded.setSeconds(0, 0);
  const minutes = rounded.getMinutes();
  const remainder = minutes % 30;
  if (remainder !== 0) {
    rounded.setMinutes(minutes + (30 - remainder));
  }
  return rounded;
}

function overlaps(
  start: number,
  end: number,
  busyBlocks: Array<{ start: string; end: string }>,
): boolean {
  return busyBlocks.some((block) => {
    const busyStart = new Date(block.start).getTime();
    const busyEnd = new Date(block.end).getTime();
    return start < busyEnd && end > busyStart;
  });
}

export async function getCalendarAvailability(input: {
  rangeStart: string;
  rangeEnd: string;
  durationMinutes: number;
  dayStartHour?: number;
  dayEndHour?: number;
  maxSuggestions?: number;
}): Promise<AvailabilityResponse> {
  const raw = await runGogJson([
    "calendar",
    "freebusy",
    "--all",
    "--from",
    input.rangeStart,
    "--to",
    input.rangeEnd,
  ]);

  const busyBlocks = normalizeBusyBlocks(raw);
  const candidateSlots: AvailabilitySlot[] = [];
  const durationMs = input.durationMinutes * 60 * 1000;
  const maxSuggestions = input.maxSuggestions ?? 5;
  const startHour = input.dayStartHour ?? 9;
  const endHour = input.dayEndHour ?? 18;

  const rangeStart = roundUpToHalfHour(new Date(input.rangeStart));
  const rangeEnd = new Date(input.rangeEnd);

  for (
    let cursor = new Date(rangeStart);
    cursor.getTime() + durationMs <= rangeEnd.getTime() &&
    candidateSlots.length < maxSuggestions;
    cursor = new Date(cursor.getTime() + 30 * 60 * 1000)
  ) {
    const slotStart = cursor.getTime();
    const slotEnd = slotStart + durationMs;

    const hour = cursor.getHours();
    if (hour < startHour || hour >= endHour) {
      continue;
    }

    const endDate = new Date(slotEnd);
    if (endDate.getHours() > endHour || slotEnd > rangeEnd.getTime()) {
      continue;
    }

    if (overlaps(slotStart, slotEnd, busyBlocks)) {
      continue;
    }

    candidateSlots.push({
      start: new Date(slotStart).toISOString(),
      end: endDate.toISOString(),
      label: formatSlotLabel(new Date(slotStart), endDate),
    });
  }

  return {
    rangeStart: input.rangeStart,
    rangeEnd: input.rangeEnd,
    durationMinutes: input.durationMinutes,
    candidateSlots,
    busyBlocks,
  };
}

export async function prepareCalendarEvent(input: {
  userRequest: string;
  title: string;
  rangeStart: string;
  rangeEnd: string;
  durationMinutes: number;
  attendees?: string[];
  description?: string;
  location?: string;
  withMeet?: boolean;
  calendarId?: string;
  dayStartHour?: number;
  dayEndHour?: number;
  maxSuggestions?: number;
}): Promise<EventProposal> {
  const [availability, relatedContext] = await Promise.all([
    getCalendarAvailability({
      rangeStart: input.rangeStart,
      rangeEnd: input.rangeEnd,
      durationMinutes: input.durationMinutes,
      dayStartHour: input.dayStartHour,
      dayEndHour: input.dayEndHour,
      maxSuggestions: input.maxSuggestions,
    }),
    searchGoogleContext({
      query: input.userRequest,
      sources: ["calendar", "drive", "docs"],
    }).catch(() => ({ query: input.userRequest, results: [], warnings: [] })),
  ]);

  return {
    proposedEvent: {
      calendarId: input.calendarId ?? "primary",
      title: input.title,
      description: input.description,
      location: input.location,
      attendees: input.attendees ?? [],
      durationMinutes: input.durationMinutes,
      withMeet: Boolean(input.withMeet),
    },
    candidateSlots: availability.candidateSlots,
    relatedContext: relatedContext.results.slice(0, 6),
    warnings: relatedContext.warnings,
  };
}

export async function createCalendarEvent(input: {
  calendarId?: string;
  title: string;
  start: string;
  end: string;
  attendees?: string[];
  description?: string;
  location?: string;
  withMeet?: boolean;
}): Promise<CreatedEvent> {
  const args = [
    "calendar",
    "create",
    input.calendarId ?? "primary",
    "--summary",
    input.title,
    "--from",
    input.start,
    "--to",
    input.end,
  ];

  if (input.description) {
    args.push("--description", input.description);
  }

  if (input.location) {
    args.push("--location", input.location);
  }

  if (input.attendees?.length) {
    args.push("--attendees", input.attendees.join(","));
  }

  if (input.withMeet) {
    args.push("--with-meet");
  }

  const raw = await runGogJson(args);

  return {
    success: true,
    eventId: stringFrom(raw, "id", "eventId"),
    eventLink: stringFrom(raw, "htmlLink", "link"),
  };
}
