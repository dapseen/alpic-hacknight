import "../index.css";
import { useDisplayMode, useLayout, useUser } from "skybridge/web";
import { useToolInfo } from "../helpers.js";

function formatDateTime(
  value: string | undefined,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(locale, options).format(date);
}

export default function GetDailyBrief() {
  const toolInfo = useToolInfo<"get-daily-brief">();
  const [displayMode, setDisplayMode] = useDisplayMode();
  const { theme } = useLayout();
  const { locale } = useUser();

  const shellClass = `assistant-shell theme-${theme}${displayMode === "fullscreen" ? " fullscreen" : ""}`;

  if (toolInfo.isPending) {
    return (
      <div className={shellClass}>
        <div className="assistant-eyebrow">Personal brief</div>
        <h1 className="assistant-title">Pulling together your day.</h1>
        <p className="assistant-subtitle">
          Reading Tasks, Calendar, and Gmail so the assistant can brief you.
        </p>
      </div>
    );
  }

  if (!toolInfo.isSuccess) {
    return null;
  }

  const { output } = toolInfo;
  const summary = `${output.tasks.length} tasks, ${output.events.length} events, ${output.pendingMessages.length} pending messages`;

  return (
    <div className={shellClass} data-llm={`Daily brief loaded: ${summary}.`}>
      <div className="assistant-topbar">
        <div>
          <div className="assistant-eyebrow">
            {output.period === "day" ? "Daily focus" : "Weekly focus"}
          </div>
          <h1 className="assistant-title">What needs your attention.</h1>
          <p className="assistant-subtitle">{summary}</p>
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
            <h2 className="assistant-section-title">Tasks</h2>
            <span className="assistant-badge">{output.tasks.length}</span>
          </div>
          {output.tasks.length > 0 ? (
            <div className="assistant-list">
              {output.tasks.map((task) => (
                <article
                  className="assistant-item"
                  key={task.id}
                  data-llm={`Task: ${task.title}${task.due ? `, due ${task.due}` : ""}`}
                >
                  <h3 className="assistant-item-title">{task.title}</h3>
                  <p className="assistant-item-meta">
                    {[task.listTitle, formatDateTime(task.due, locale, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {task.notes ? (
                    <p className="assistant-item-copy">{task.notes}</p>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="assistant-empty">No open tasks in the selected window.</p>
          )}
        </section>

        <section className="assistant-section">
          <div className="assistant-section-header">
            <h2 className="assistant-section-title">Events</h2>
            <span className="assistant-badge">{output.events.length}</span>
          </div>
          {output.events.length > 0 ? (
            <div className="assistant-list">
              {output.events.map((event) => (
                <article
                  className="assistant-item"
                  key={event.id}
                  data-llm={`Event: ${event.title}${event.start ? ` at ${event.start}` : ""}`}
                >
                  <h3 className="assistant-item-title">{event.title}</h3>
                  <p className="assistant-item-meta">
                    {[formatDateTime(event.start, locale, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    }), event.location]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {event.attendees.length > 0 ? (
                    <p className="assistant-item-copy">
                      {event.attendees.slice(0, 3).join(", ")}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="assistant-empty">No upcoming events in this window.</p>
          )}
        </section>

        <section className="assistant-section">
          <div className="assistant-section-header">
            <h2 className="assistant-section-title">Pending messages</h2>
            <span className="assistant-badge">{output.pendingMessages.length}</span>
          </div>
          {output.pendingMessages.length > 0 ? (
            <div className="assistant-list">
              {output.pendingMessages.map((message) => (
                <article
                  className="assistant-item"
                  key={message.threadId}
                  data-llm={`Pending message: ${message.subject}${message.from ? ` from ${message.from}` : ""}`}
                >
                  <h3 className="assistant-item-title">{message.subject}</h3>
                  <p className="assistant-item-meta">
                    {[message.from, formatDateTime(message.date, locale, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {message.snippet ? (
                    <p className="assistant-item-copy">{message.snippet}</p>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="assistant-empty">No unread inbox threads matched the brief.</p>
          )}
        </section>
      </div>

      {output.warnings.length > 0 ? (
        <p className="assistant-warning">{output.warnings.join(" ")}</p>
      ) : null}
    </div>
  );
}
