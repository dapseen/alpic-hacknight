import "../index.css";
import { useEffect } from "react";
import { useDisplayMode, useLayout, useUser, useViewState } from "skybridge/web";
import { useCallTool, useToolInfo } from "../helpers.js";

function formatSlot(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

type EventState = {
  initializedKey: string;
  selectedSlotStart: string;
  confirmCreate: boolean;
};

export default function CreateCalendarEvent() {
  const toolInfo = useToolInfo<"create-calendar-event">();
  const { callTool, data, isPending: isCreating, isSuccess: isCreated } =
    useCallTool("confirm-calendar-event");
  const [displayMode, setDisplayMode] = useDisplayMode();
  const { theme } = useLayout();
  const { locale } = useUser();
  const [state, setState] = useViewState<EventState>({
    initializedKey: "",
    selectedSlotStart: "",
    confirmCreate: false,
  });

  const shellClass = `assistant-shell theme-${theme}${displayMode === "fullscreen" ? " fullscreen" : ""}`;

  useEffect(() => {
    if (!toolInfo.isSuccess) {
      return;
    }

    const firstSlot = toolInfo.output.candidateSlots[0];
    const nextKey = `${toolInfo.output.proposedEvent.title}:${firstSlot?.start ?? "none"}`;
    if (state.initializedKey === nextKey) {
      return;
    }

    setState({
      initializedKey: nextKey,
      selectedSlotStart: firstSlot?.start ?? "",
      confirmCreate: false,
    });
  }, [setState, state.initializedKey, toolInfo]);

  if (toolInfo.isPending) {
    return (
      <div className={shellClass}>
        <div className="assistant-eyebrow">Scheduling</div>
        <h1 className="assistant-title">Checking free time and shaping the event.</h1>
      </div>
    );
  }

  if (!toolInfo.isSuccess) {
    return null;
  }

  const { output } = toolInfo;
  const selectedSlot =
    output.candidateSlots.find((slot) => slot.start === state.selectedSlotStart) ??
    output.candidateSlots[0];

  return (
    <div
      className={shellClass}
      data-llm={`Event proposal for ${output.proposedEvent.title}. Selected slot: ${
        selectedSlot?.label ?? "none"
      }.`}
    >
      <div className="assistant-topbar">
        <div>
          <div className="assistant-eyebrow">Event confirmation</div>
          <h1 className="assistant-title">{output.proposedEvent.title}</h1>
          <p className="assistant-subtitle">
            Choose a slot, review the details, then confirm before the event is created.
          </p>
        </div>
        <div className="assistant-actions">
          <button
            className="assistant-button secondary"
            onClick={() =>
              void setDisplayMode(
                displayMode === "fullscreen" ? "inline" : "fullscreen",
              )
            }
            type="button"
          >
            {displayMode === "fullscreen" ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>

      <div className="assistant-grid">
        <section className="assistant-section">
          <div className="assistant-section-header">
            <h2 className="assistant-section-title">Candidate slots</h2>
            <span className="assistant-badge">{output.candidateSlots.length}</span>
          </div>
          {output.candidateSlots.length > 0 ? (
            <div className="assistant-slot-grid">
              {output.candidateSlots.map((slot) => (
                <button
                  className={`assistant-slot${
                    state.selectedSlotStart === slot.start ? " selected" : ""
                  }`}
                  key={slot.start}
                  onClick={() =>
                    setState((current: EventState) => ({
                      ...current,
                      selectedSlotStart: slot.start,
                      confirmCreate: false,
                    }))
                  }
                  type="button"
                >
                  <strong>{slot.label}</strong>
                  <div className="assistant-item-meta">
                    {formatSlot(slot.start, locale)} to {formatSlot(slot.end, locale)}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <p className="assistant-empty">
              No free slots were found in the requested window.
            </p>
          )}
        </section>

        <section className="assistant-section">
          <div className="assistant-section-header">
            <h2 className="assistant-section-title">Event details</h2>
            <span className="assistant-badge">{output.proposedEvent.durationMinutes}m</span>
          </div>
          <div className="assistant-list">
            <article className="assistant-item">
              <h3 className="assistant-item-title">{output.proposedEvent.title}</h3>
              <p className="assistant-item-meta">
                {selectedSlot ? selectedSlot.label : "Pick a slot to continue"}
              </p>
              {output.proposedEvent.description ? (
                <p className="assistant-item-copy">{output.proposedEvent.description}</p>
              ) : null}
            </article>

            {output.proposedEvent.attendees.length > 0 ? (
              <article className="assistant-item">
                <h3 className="assistant-item-title">Attendees</h3>
                <p className="assistant-item-copy">
                  {output.proposedEvent.attendees.join(", ")}
                </p>
              </article>
            ) : null}

            {output.proposedEvent.location ? (
              <article className="assistant-item">
                <h3 className="assistant-item-title">Location</h3>
                <p className="assistant-item-copy">{output.proposedEvent.location}</p>
              </article>
            ) : null}
          </div>
        </section>
      </div>

      {output.relatedContext.length > 0 ? (
        <section className="assistant-section" style={{ marginTop: 14 }}>
          <div className="assistant-section-header">
            <h2 className="assistant-section-title">Related context</h2>
            <span className="assistant-badge">{output.relatedContext.length}</span>
          </div>
          <div className="assistant-list">
            {output.relatedContext.map((result) => (
              <article className="assistant-item" key={`${result.source}:${result.id}`}>
                <h3 className="assistant-item-title">{result.title}</h3>
                <p className="assistant-item-meta">
                  {[result.source, result.when, result.subtitle]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="assistant-confirmation" style={{ marginTop: 14 }}>
        <p className="assistant-helper">
          {state.confirmCreate
            ? "Confirming will create the event in Google Calendar."
            : "The event is only proposed until you confirm."}
        </p>

        <div className="assistant-actions">
          {!state.confirmCreate ? (
            <button
              className="assistant-button secondary"
              disabled={!selectedSlot}
              onClick={() =>
                setState((current: EventState) => ({ ...current, confirmCreate: true }))
              }
              type="button"
            >
              Review create
            </button>
          ) : (
            <>
              <button
                className="assistant-button primary"
                disabled={!selectedSlot || isCreating}
                onClick={() =>
                  selectedSlot &&
                  callTool({
                    calendarId: output.proposedEvent.calendarId,
                    title: output.proposedEvent.title,
                    start: selectedSlot.start,
                    end: selectedSlot.end,
                    attendees: output.proposedEvent.attendees,
                    description: output.proposedEvent.description,
                    location: output.proposedEvent.location,
                    withMeet: output.proposedEvent.withMeet,
                  })
                }
                type="button"
              >
                {isCreating ? "Creating..." : "Create event"}
              </button>
              <button
                className="assistant-button secondary"
                onClick={() =>
                  setState((current: EventState) => ({ ...current, confirmCreate: false }))
                }
                type="button"
              >
                Cancel
              </button>
            </>
          )}
        </div>

        {isCreated ? (
          <p className="assistant-success">
            Event created.
            {data.structuredContent.eventLink ? (
              <>
                {" "}
                <a
                  className="assistant-link"
                  href={data.structuredContent.eventLink}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open in Calendar
                </a>
              </>
            ) : null}
          </p>
        ) : null}
      </section>

      {output.warnings.length > 0 ? (
        <p className="assistant-warning">{output.warnings.join(" ")}</p>
      ) : null}
    </div>
  );
}
