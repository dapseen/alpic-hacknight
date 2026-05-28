import "../index.css";
import { useEffect } from "react";
import { useDisplayMode, useLayout, useUser, useViewState } from "skybridge/web";
import { useCallTool, useToolInfo } from "../helpers.js";

function parseEmails(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function formatDate(value: string | undefined, locale: string): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

type ReplyState = {
  initializedThreadId: string;
  subject: string;
  body: string;
  toText: string;
  ccText: string;
  replyAll: boolean;
  confirmSend: boolean;
};

export default function DraftEmailReply() {
  const toolInfo = useToolInfo<"draft-email-reply">();
  const { callTool, data, isPending: isSending, isSuccess: isSent } =
    useCallTool("send-email-reply");
  const [displayMode, setDisplayMode] = useDisplayMode();
  const { theme } = useLayout();
  const { locale } = useUser();
  const [state, setState] = useViewState<ReplyState>({
    initializedThreadId: "",
    subject: "",
    body: "",
    toText: "",
    ccText: "",
    replyAll: false,
    confirmSend: false,
  });

  const shellClass = `assistant-shell theme-${theme}${displayMode === "fullscreen" ? " fullscreen" : ""}`;

  useEffect(() => {
    if (!toolInfo.isSuccess) {
      return;
    }

    if (state.initializedThreadId === toolInfo.output.thread.threadId) {
      return;
    }

    setState({
      initializedThreadId: toolInfo.output.thread.threadId,
      subject: toolInfo.output.subject,
      body: toolInfo.output.suggestedReply,
      toText: toolInfo.output.thread.defaultTo.join(", "),
      ccText: toolInfo.output.thread.defaultCc.join(", "),
      replyAll: false,
      confirmSend: false,
    });
  }, [setState, state.initializedThreadId, toolInfo]);

  if (toolInfo.isPending) {
    return (
      <div className={shellClass}>
        <div className="assistant-eyebrow">Reply draft</div>
        <h1 className="assistant-title">Resolving the thread and shaping the draft.</h1>
      </div>
    );
  }

  if (!toolInfo.isSuccess) {
    return null;
  }

  const { output } = toolInfo;

  return (
    <div
      className={shellClass}
      data-llm={`Email reply draft loaded for ${output.subject}. Current recipients: ${
        state.replyAll ? "reply all" : state.toText || "none"
      }.`}
    >
      <div className="assistant-topbar">
        <div>
          <div className="assistant-eyebrow">Reply approval</div>
          <h1 className="assistant-title">{output.subject}</h1>
          <p className="assistant-subtitle">
            Review the context, edit the draft if needed, then confirm before send.
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
            <h2 className="assistant-section-title">Thread context</h2>
            <span className="assistant-badge">{output.thread.messages.length}</span>
          </div>
          <div className="assistant-list">
            {output.thread.messages.map((message) => (
              <article
                className="assistant-item"
                key={message.id}
                data-llm={`Message from ${message.from ?? "unknown sender"}: ${
                  message.snippet ?? message.body ?? ""
                }`}
              >
                <h3 className="assistant-item-title">{message.from ?? "Unknown sender"}</h3>
                <p className="assistant-item-meta">
                  {[formatDate(message.date, locale), message.to]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="assistant-item-copy">
                  {message.body ?? message.snippet ?? "No message body available."}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="assistant-section">
          <div className="assistant-section-header">
            <h2 className="assistant-section-title">Draft</h2>
            <span className="assistant-badge">Editable</span>
          </div>
          <div className="assistant-form">
            <div>
              <label className="assistant-label" htmlFor="reply-subject">
                Subject
              </label>
              <input
                className="assistant-input"
                id="reply-subject"
                onChange={(event: { target: { value: string } }) =>
                  setState((current: ReplyState) => ({
                    ...current,
                    subject: event.target.value,
                    confirmSend: false,
                  }))
                }
                value={state.subject}
              />
            </div>

            <div>
              <label className="assistant-label" htmlFor="reply-to">
                To
              </label>
              <input
                className="assistant-input"
                disabled={state.replyAll}
                id="reply-to"
                onChange={(event: { target: { value: string } }) =>
                  setState((current: ReplyState) => ({
                    ...current,
                    toText: event.target.value,
                    confirmSend: false,
                  }))
                }
                value={state.toText}
              />
            </div>

            <div>
              <label className="assistant-label" htmlFor="reply-cc">
                CC
              </label>
              <input
                className="assistant-input"
                disabled={state.replyAll}
                id="reply-cc"
                onChange={(event: { target: { value: string } }) =>
                  setState((current: ReplyState) => ({
                    ...current,
                    ccText: event.target.value,
                    confirmSend: false,
                  }))
                }
                value={state.ccText}
              />
            </div>

            <label className="assistant-pill">
              <input
                checked={state.replyAll}
                onChange={(event: { target: { checked: boolean } }) =>
                  setState((current: ReplyState) => ({
                    ...current,
                    replyAll: event.target.checked,
                    confirmSend: false,
                  }))
                }
                type="checkbox"
              />
              Reply all
            </label>

            <div>
              <label className="assistant-label" htmlFor="reply-body">
                Message
              </label>
              <textarea
                className="assistant-textarea"
                id="reply-body"
                onChange={(event: { target: { value: string } }) =>
                  setState((current: ReplyState) => ({
                    ...current,
                    body: event.target.value,
                    confirmSend: false,
                  }))
                }
                value={state.body}
              />
            </div>
          </div>
        </section>
      </div>

      {output.relatedEvents.length > 0 ? (
        <section className="assistant-section" style={{ marginTop: 14 }}>
          <div className="assistant-section-header">
            <h2 className="assistant-section-title">Calendar context</h2>
            <span className="assistant-badge">{output.relatedEvents.length}</span>
          </div>
          <div className="assistant-pill-row">
            {output.relatedEvents.map((event) => (
              <div className="assistant-pill" key={event.id}>
                <strong>{event.title}</strong>
                <span>{formatDate(event.start, locale) ?? event.location ?? "Upcoming"}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="assistant-confirmation" style={{ marginTop: 14 }}>
        <p className="assistant-helper">
          {state.confirmSend
            ? "Confirming will send the reply through Gmail."
            : "Nothing is sent until you explicitly confirm."}
        </p>

        <div className="assistant-actions">
          {!state.confirmSend ? (
            <button
              className="assistant-button secondary"
              onClick={() =>
                setState((current: ReplyState) => ({ ...current, confirmSend: true }))
              }
              type="button"
            >
              Review send
            </button>
          ) : (
            <>
              <button
                className="assistant-button primary"
                disabled={isSending}
                onClick={() =>
                  callTool({
                    threadId: output.thread.threadId,
                    replyToMessageId: output.thread.latestMessageId,
                    to: state.replyAll ? undefined : parseEmails(state.toText),
                    cc: state.replyAll ? undefined : parseEmails(state.ccText),
                    subject: state.subject,
                    replyBody: state.body,
                    replyAll: state.replyAll,
                  })
                }
                type="button"
              >
                {isSending ? "Sending..." : "Send reply"}
              </button>
              <button
                className="assistant-button secondary"
                onClick={() =>
                  setState((current: ReplyState) => ({ ...current, confirmSend: false }))
                }
                type="button"
              >
                Cancel
              </button>
            </>
          )}
        </div>

        {isSent ? (
          <p className="assistant-success">
            Reply sent{data.structuredContent.messageId ? ` (${data.structuredContent.messageId})` : ""}.
          </p>
        ) : null}
      </section>

      {output.warnings.length > 0 ? (
        <p className="assistant-warning">{output.warnings.join(" ")}</p>
      ) : null}
    </div>
  );
}
