import { useCallback, useState } from "react";
import { Check, Copy } from "lucide-react";

import { copyTextToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

/**
 * Small copy affordance shared by messages and code blocks. Shows a check for
 * a moment after a successful copy; a failed clipboard write stays silent but
 * does not fake success.
 */
export function ChatCopyButton({
  text,
  label,
  copiedLabel,
  className,
}: {
  text: string;
  label: string;
  copiedLabel: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const onClick = useCallback(() => {
    void copyTextToClipboard(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_400);
    });
  }, [text]);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex items-center gap-1 rounded border border-border/70 bg-background/70 px-1.5 py-0.5",
        "text-[11px] text-text-tertiary transition-colors",
        "hover:border-border hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary/60",
        className,
      )}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      <span>{copied ? copiedLabel : label}</span>
    </button>
  );
}
