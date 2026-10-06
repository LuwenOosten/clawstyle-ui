import { useMemo, useState } from "react";
import { MessageCircleQuestion } from "lucide-react";

import { Button } from "@/ui";
import { cn } from "@/lib/utils";
import type { ChatClarifyRequest } from "@/features/chat/types";
import { useChatI18n } from "@/features/chat/useChatI18n";

/**
 * The `clarify` tool's question card. Answers are submitted together as the
 * contract expects: choice label for single-select, a JSON array string for
 * multi-select, the typed text for free-form, and `null` when skipped.
 */
export function ChatClarifyCard({
  request,
  onSubmit,
  onSkip,
}: {
  request: ChatClarifyRequest;
  onSubmit: (answers: Record<string, string | null>) => void;
  onSkip: () => void;
}) {
  const copy = useChatI18n();
  const questions = useMemo(
    () => request.params.questions ?? [],
    [request.params.questions],
  );
  const [text, setText] = useState<Record<string, string>>({});
  const [single, setSingle] = useState<Record<string, string | null>>(() => {
    const initial: Record<string, string | null> = {};
    for (const question of questions) {
      initial[question.qid] = request.params.answers?.[question.qid] ?? null;
    }
    return initial;
  });
  const [multi, setMulti] = useState<Record<string, string[]>>({});

  const toggleMulti = (qid: string, choice: string) => {
    setMulti((previous) => {
      const current = previous[qid] ?? [];
      const next = current.includes(choice)
        ? current.filter((item) => item !== choice)
        : [...current, choice];
      return { ...previous, [qid]: next };
    });
  };

  const submit = () => {
    const answers: Record<string, string | null> = {};
    for (const question of questions) {
      if (question.multi_select && question.choices?.length) {
        const selected = multi[question.qid] ?? [];
        answers[question.qid] = selected.length
          ? JSON.stringify(selected)
          : null;
      } else if (question.choices?.length) {
        answers[question.qid] = single[question.qid] ?? null;
      } else {
        const value = (text[question.qid] ?? "").trim();
        answers[question.qid] = value || null;
      }
    }
    onSubmit(answers);
  };

  return (
    <div
      role="alertdialog"
      aria-label={copy.clarifyTitle}
      data-chat-request="clarify"
      data-request-id={request.id}
      className={cn(
        "mx-auto w-full max-w-[46rem] rounded-xl border border-primary/50 bg-primary/5 p-3",
      )}
    >
      <div className="flex items-start gap-2">
        <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <p className="text-sm font-semibold text-foreground">{copy.clarifyTitle}</p>
      </div>

      <div className="mt-3 space-y-4">
        {questions.map((question) => (
          <fieldset key={question.qid} className="min-w-0">
            <legend className="text-sm text-foreground">{question.question}</legend>
            {question.choices?.length ? (
              <div className="mt-2 space-y-1.5">
                {question.choices.map((choice) =>
                  question.multi_select ? (
                    <label
                      key={choice}
                      className="flex cursor-pointer items-center gap-2 text-xs text-text-secondary"
                    >
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-primary"
                        checked={(multi[question.qid] ?? []).includes(choice)}
                        onChange={() => toggleMulti(question.qid, choice)}
                      />
                      <span>{choice}</span>
                    </label>
                  ) : (
                    <label
                      key={choice}
                      className="flex cursor-pointer items-center gap-2 text-xs text-text-secondary"
                    >
                      <input
                        type="radio"
                        name={`clarify-${request.id}-${question.qid}`}
                        className="h-3.5 w-3.5 accent-primary"
                        checked={single[question.qid] === choice}
                        onChange={() =>
                          setSingle((previous) => ({
                            ...previous,
                            [question.qid]: choice,
                          }))
                        }
                      />
                      <span>{choice}</span>
                    </label>
                  ),
                )}
              </div>
            ) : (
              <textarea
                value={text[question.qid] ?? ""}
                onChange={(event) =>
                  setText((previous) => ({
                    ...previous,
                    [question.qid]: event.target.value,
                  }))
                }
                rows={2}
                placeholder={copy.clarifyOther}
                aria-label={question.question}
                className="mt-2 w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
              />
            )}
          </fieldset>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" onClick={submit} data-chat-clarify="submit">
          {copy.clarifySubmit}
        </Button>
        <Button variant="secondary" size="sm" onClick={onSkip} data-chat-clarify="skip">
          {copy.clarifySkip}
        </Button>
      </div>
    </div>
  );
}
