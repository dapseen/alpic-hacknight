# Personal Google Assistant

## Value Proposition
A personal assistant app for a single user that helps triage email, stay aware of calendar context, and take lightweight Google Workspace actions through conversation.

The current pain is that email triage is manual and ChatGPT lacks awareness of calendar context and important Google activity.

Core actions:
- Generate a daily or weekly todo-style brief from Google Tasks and Calendar
- Surface pending messages and important events when asked what matters today
- Draft email replies and create calendar events with explicit confirmation before writes

## Why LLM?
Conversational win:
Natural language is a better interface for requests like "what do I need to know today?", "draft a reply to this", or "find time next week" than switching between Gmail, Calendar, and Tasks manually.

LLM adds:
- Intent understanding from open-ended requests
- Prioritization and summarization across email, tasks, and events
- Draft generation for email replies
- Converting conversational requests into proposed calendar events

What LLM lacks:
- Direct access to Google account data
- Ability to read live Gmail/Calendar/Tasks/Drive/Docs state
- Ability to create events or send email without external tooling

Those capabilities are provided through `gog`, which will already be authenticated on the server.

## UI Overview
First view:
A daily or weekly todo-style dashboard built from tasks and events.

Key interactions:
- "What do I need to know today?" shows pending messages and important events
- Email drafting shows a structured draft card before send
- Event creation always shows a confirmation step before writing
- Search and context retrieval can pull from Gmail, Calendar, Tasks, Drive, and Docs as needed

End state:
Depending on the task, the experience concludes with:
- a brief
- a draft ready for approval
- an event ready for confirmation
- or a completed action after explicit approval

## Product Context
- User scope: personal use only for now
- Google surfaces: Gmail, Calendar, Tasks, Drive, Docs
- Account scope: personal Google account only
- Auth model: `gog` is pre-authenticated on the server
- Safety model: all write actions require confirmation
- Write actions allowed in v1: create calendar events, send drafted emails after approval

## UX Flows
Get daily brief:
1. Build a daily or weekly brief
2. Show separate sections for tasks, events, and pending messages
3. Use Gmail/Drive/Docs search internally when supporting context is needed

Draft email reply:
1. User asks in natural language
2. App finds the relevant thread or message
3. App generates a reply draft with calendar-aware context when relevant
4. User reviews a draft card
5. Email is sent only after confirmation

Create calendar event:
1. User asks in natural language
2. App proposes one or more time slots based on calendar availability
3. User reviews a confirmation card
4. Event is created only after confirmation

## Tools and Views
**View: get_daily_brief**
- **Input**: `{ period: "day" | "week" }`
- **Output**: `{ tasks[], events[], pendingMessages[] }`
- **UI**: separate sections for tasks, events, and messages
- **Behavior**: can refresh and launch follow-up actions like drafting a reply or proposing an event

**View: draft_email_reply**
- **Input**: `{ userRequest: string }`
- **Output**: `{ thread, message, suggestedReply, relatedEvents[] }`
- **UI**: message context, draft card, and approval actions
- **Behavior**: resolves the target thread from natural language, pulls calendar context when relevant, and calls send only after approval

**Tool: send_email_reply**
- **Input**: `{ threadId, replyBody, subject? }`
- **Output**: `{ success, messageId }`

**View: create_calendar_event**
- **Input**: `{ userRequest: string }`
- **Output**: `{ proposedEvent, candidateSlots[], relatedContext? }`
- **UI**: proposed event details, slot choices, and confirmation
- **Behavior**: interprets the request, checks availability, suggests times, then calls create only after approval

**Tool: create_calendar_event**
- **Input**: `{ title, start, end, attendees?, description?, location? }`
- **Output**: `{ success, eventId, eventLink? }`

**Tool: search_google_context**
- **Input**: `{ query, sources: ["gmail" | "calendar" | "tasks" | "drive" | "docs"] }`
- **Output**: `{ results[] }`

**Tool: get_calendar_availability**
- **Input**: `{ dateRange, durationMinutes, constraints? }`
- **Output**: `{ candidateSlots[] }`
