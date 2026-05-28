import { McpServer } from "skybridge/server";
import { z } from "zod";
import {
  createCalendarEvent,
  getCalendarAvailability,
  getDailyBrief,
  prepareCalendarEvent,
  prepareDraftReply,
  searchGoogleContext,
  sendDraftReply,
} from "./gog.js";

const periodEnum = z.enum(["day", "week"]);
const sourceEnum = z.enum(["gmail", "calendar", "tasks", "drive", "docs"]);

const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  due: z.string().optional(),
  updated: z.string().optional(),
  notes: z.string().optional(),
  listId: z.string().optional(),
  listTitle: z.string().optional(),
  status: z.enum(["needsAction", "completed"]),
});

const eventSchema = z.object({
  id: z.string(),
  title: z.string(),
  start: z.string().optional(),
  end: z.string().optional(),
  location: z.string().optional(),
  status: z.string().optional(),
  attendees: z.array(z.string()),
  link: z.string().optional(),
});

const pendingMessageSchema = z.object({
  threadId: z.string(),
  messageId: z.string().optional(),
  subject: z.string(),
  from: z.string().optional(),
  snippet: z.string().optional(),
  date: z.string().optional(),
  unread: z.boolean().optional(),
});

const contextResultSchema = z.object({
  source: sourceEnum,
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  url: z.string().optional(),
  when: z.string().optional(),
  mimeType: z.string().optional(),
});

const slotSchema = z.object({
  start: z.string(),
  end: z.string(),
  label: z.string(),
});

const threadMessageSchema = z.object({
  id: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  cc: z.string().optional(),
  subject: z.string().optional(),
  date: z.string().optional(),
  snippet: z.string().optional(),
  body: z.string().optional(),
});

const server = new McpServer(
  {
    name: "personal-google-assistant",
    version: "0.1.0",
  },
  { capabilities: {} },
)
  .registerTool(
    {
      name: "get-daily-brief",
      description:
        "Build a daily or weekly brief from Google Tasks, Calendar, and Gmail unread threads.",
      inputSchema: {
        period: periodEnum.default("day"),
        referenceDate: z
          .string()
          .optional()
          .describe("Optional ISO date/time used to anchor the brief."),
        maxTasks: z.number().int().positive().max(25).optional(),
        maxEvents: z.number().int().positive().max(20).optional(),
        maxMessages: z.number().int().positive().max(20).optional(),
      },
      outputSchema: {
        period: periodEnum,
        rangeStart: z.string(),
        rangeEnd: z.string(),
        tasks: z.array(taskSchema),
        events: z.array(eventSchema),
        pendingMessages: z.array(pendingMessageSchema),
        warnings: z.array(z.string()),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
      view: {
        component: "get-daily-brief",
        description: "Daily or weekly assistant brief.",
      },
    },
    async ({ period, referenceDate, maxTasks, maxEvents, maxMessages }) => {
      const brief = await getDailyBrief({
        period,
        referenceDate,
        maxTasks,
        maxEvents,
        maxMessages,
      });

      return {
        structuredContent: brief,
        content: [
          {
            type: "text",
            text: `Prepared a ${brief.period} brief with ${brief.tasks.length} tasks, ${brief.events.length} events, and ${brief.pendingMessages.length} pending messages.`,
          },
        ],
      };
    },
  )
  .registerTool(
    {
      name: "draft-email-reply",
      description:
        "Prepare a reviewable email reply card. The model should supply the draft text and a Gmail query or thread id if it can infer one from the user's request.",
      inputSchema: {
        userRequest: z.string(),
        draftReply: z
          .string()
          .describe("The proposed email body to show in the approval card."),
        gmailQuery: z
          .string()
          .optional()
          .describe("Optional Gmail search query if the target thread can be inferred."),
        threadId: z
          .string()
          .optional()
          .describe("Optional exact Gmail thread id when already known."),
        subject: z.string().optional(),
        maxRelatedEvents: z.number().int().positive().max(8).optional(),
      },
      outputSchema: {
        thread: z.object({
          threadId: z.string(),
          latestMessageId: z.string().optional(),
          subject: z.string(),
          snippet: z.string().optional(),
          messages: z.array(threadMessageSchema),
          defaultTo: z.array(z.string()),
          defaultCc: z.array(z.string()),
        }),
        suggestedReply: z.string(),
        subject: z.string(),
        relatedEvents: z.array(eventSchema),
        warnings: z.array(z.string()),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
      view: {
        component: "draft-email-reply",
        description: "Draft email reply approval card.",
      },
    },
    async ({ userRequest, draftReply, gmailQuery, threadId, subject, maxRelatedEvents }) => {
      const draft = await prepareDraftReply({
        userRequest,
        draftReply,
        gmailQuery,
        threadId,
        subject,
        maxRelatedEvents,
      });

      return {
        structuredContent: draft,
        content: [
          {
            type: "text",
            text: `Prepared a reply draft for "${draft.subject}". Review it in the card before sending.`,
          },
        ],
      };
    },
  )
  .registerTool(
    {
      name: "send-email-reply",
      description:
        "Send an approved Gmail reply or draft. Call this only after the user has explicitly confirmed the draft.",
      inputSchema: {
        threadId: z.string().optional(),
        replyToMessageId: z.string().optional(),
        to: z.array(z.string()).optional(),
        cc: z.array(z.string()).optional(),
        bcc: z.array(z.string()).optional(),
        subject: z.string(),
        replyBody: z.string(),
        replyAll: z.boolean().optional(),
        quoteOriginal: z.boolean().optional(),
      },
      outputSchema: {
        success: z.literal(true),
        messageId: z.string().optional(),
        threadId: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false,
      },
    },
    async (input) => {
      const sent = await sendDraftReply(input);
      return {
        structuredContent: sent,
        content: [
          {
            type: "text",
            text: "The email reply has been sent.",
          },
        ],
      };
    },
  )
  .registerTool(
    {
      name: "create-calendar-event",
      description:
        "Prepare a calendar event proposal with candidate time slots. The model should parse the user's natural-language scheduling request into the structured fields below.",
      inputSchema: {
        userRequest: z.string(),
        title: z.string(),
        rangeStart: z
          .string()
          .describe("RFC3339 timestamp for the beginning of the search window."),
        rangeEnd: z
          .string()
          .describe("RFC3339 timestamp for the end of the search window."),
        durationMinutes: z.number().int().positive().max(480),
        attendees: z.array(z.string()).optional(),
        description: z.string().optional(),
        location: z.string().optional(),
        withMeet: z.boolean().optional(),
        calendarId: z.string().optional(),
        dayStartHour: z.number().int().min(0).max(23).optional(),
        dayEndHour: z.number().int().min(1).max(24).optional(),
        maxSuggestions: z.number().int().positive().max(10).optional(),
      },
      outputSchema: {
        proposedEvent: z.object({
          calendarId: z.string(),
          title: z.string(),
          description: z.string().optional(),
          location: z.string().optional(),
          attendees: z.array(z.string()),
          durationMinutes: z.number().int().positive(),
          withMeet: z.boolean(),
        }),
        candidateSlots: z.array(slotSchema),
        relatedContext: z.array(contextResultSchema),
        warnings: z.array(z.string()),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
      view: {
        component: "create-calendar-event",
        description: "Calendar event proposal and confirmation card.",
      },
    },
    async (input) => {
      const proposal = await prepareCalendarEvent(input);
      return {
        structuredContent: proposal,
        content: [
          {
            type: "text",
            text: `Prepared ${proposal.candidateSlots.length} candidate slots for "${proposal.proposedEvent.title}".`,
          },
        ],
      };
    },
  )
  .registerTool(
    {
      name: "confirm-calendar-event",
      description:
        "Create a calendar event after the user confirms the chosen slot.",
      inputSchema: {
        calendarId: z.string().optional(),
        title: z.string(),
        start: z.string(),
        end: z.string(),
        attendees: z.array(z.string()).optional(),
        description: z.string().optional(),
        location: z.string().optional(),
        withMeet: z.boolean().optional(),
      },
      outputSchema: {
        success: z.literal(true),
        eventId: z.string().optional(),
        eventLink: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false,
      },
    },
    async (input) => {
      const created = await createCalendarEvent(input);
      return {
        structuredContent: created,
        content: [
          {
            type: "text",
            text: "The calendar event has been created.",
          },
        ],
      };
    },
  )
  .registerTool(
    {
      name: "search-google-context",
      description:
        "Search across Gmail, Calendar, Tasks, Drive, and Docs for supporting context.",
      inputSchema: {
        query: z.string(),
        sources: z.array(sourceEnum).default([
          "gmail",
          "calendar",
          "tasks",
          "drive",
          "docs",
        ]),
      },
      outputSchema: {
        query: z.string(),
        results: z.array(contextResultSchema),
        warnings: z.array(z.string()),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
    },
    async ({ query, sources }) => {
      const context = await searchGoogleContext({ query, sources });
      return {
        structuredContent: context,
        content: [
          {
            type: "text",
            text: `Found ${context.results.length} context results for "${query}".`,
          },
        ],
      };
    },
  )
  .registerTool(
    {
      name: "get-calendar-availability",
      description:
        "Check calendar availability and return candidate open slots for a requested duration.",
      inputSchema: {
        rangeStart: z.string(),
        rangeEnd: z.string(),
        durationMinutes: z.number().int().positive().max(480),
        dayStartHour: z.number().int().min(0).max(23).optional(),
        dayEndHour: z.number().int().min(1).max(24).optional(),
        maxSuggestions: z.number().int().positive().max(10).optional(),
      },
      outputSchema: {
        rangeStart: z.string(),
        rangeEnd: z.string(),
        durationMinutes: z.number().int().positive(),
        candidateSlots: z.array(slotSchema),
        busyBlocks: z.array(
          z.object({
            start: z.string(),
            end: z.string(),
          }),
        ),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
    },
    async (input) => {
      const availability = await getCalendarAvailability(input);
      return {
        structuredContent: availability,
        content: [
          {
            type: "text",
            text: `Found ${availability.candidateSlots.length} candidate slots.`,
          },
        ],
      };
    },
  );

if (process.env.NODE_ENV === "production") {
  const { default: manifest } = await import("./vite-manifest.js");
  server.setViteManifest(manifest);
}

export default await server.run();

export type AppType = typeof server;
