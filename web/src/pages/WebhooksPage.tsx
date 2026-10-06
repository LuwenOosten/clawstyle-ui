import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Plus,
  RotateCw,
  Trash2,
  Webhook,
} from "lucide-react";
import { api } from "@/lib/api";
import type { WebhookRoute, WebhooksResponse } from "@/lib/api";
import { copyTextToClipboard } from "@/lib/clipboard";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { useToast } from "@nous-research/ui/hooks/use-toast";
import { useConfirmDelete } from "@nous-research/ui/hooks/use-confirm-delete";
import { Toast } from "@nous-research/ui/ui/components/toast";
import { usePageHeader } from "@/contexts/usePageHeader";
import { errorMessage } from "@/lib/api-error";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  LoadingState,
  Modal,
  ModalCancel,
  SectionHeading,
  Select,
  TextArea,
  TextInput,
} from "@/ui";

interface CreatedWebhook {
  url: string;
  secret: string;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    void copyTextToClipboard(value).then((copied) => {
      if (!copied) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }, [value]);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title="Copy"
      aria-label="Copy"
      onClick={handleCopy}
      className="text-text-muted hover:text-text-primary"
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  );
}

export default function WebhooksPage() {
  const [data, setData] = useState<WebhooksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [enabling, setEnabling] = useState(false);
  const [restartNeeded, setRestartNeeded] = useState(false);
  const [restartMessage, setRestartMessage] = useState<string | null>(null);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const { toast, showToast } = useToast();
  const { setEnd } = usePageHeader();

  // New subscription modal state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [events, setEvents] = useState("");
  const [deliver, setDeliver] = useState("log");
  const [deliverOnly, setDeliverOnly] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedWebhook | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setName("");
    setDescription("");
    setEvents("");
    setDeliver("log");
    setDeliverOnly(false);
    setPrompt("");
  }, []);

  const closeCreateModal = useCallback(() => {
    // One dismissal path for Cancel/backdrop/Escape/close/discard. Clearing
    // the form here prevents a discarded draft from reappearing on reopen.
    setCreateModalOpen(false);
    setCreated(null);
    setCreateError(null);
    resetForm();
  }, [resetForm]);

  // The success panel (secret shown once) is not "dirty" — only an
  // in-progress form counts, so closing it never asks to discard a secret.
  const createDirty =
    !created &&
    (name.trim() !== "" ||
      description.trim() !== "" ||
      events.trim() !== "" ||
      deliver !== "log" ||
      deliverOnly ||
      prompt.trim() !== "");

  const enabled = data?.enabled ?? false;
  const subscriptions = data?.subscriptions ?? [];

  const loadWebhooks = useCallback(() => {
    return api
      .getWebhooks()
      .then(setData)
      .catch(() => showToast("Failed to load webhooks", "error"))
      .finally(() => setLoading(false));
  }, [showToast]);

  useEffect(() => {
    loadWebhooks();
  }, [loadWebhooks]);

  const watchRestartOutcome = useCallback(async () => {
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        const st = await api.getActionStatus("gateway-restart", 5);
        if (st.running) continue;
        if (st.exit_code !== 0 && st.exit_code !== null) {
          setRestartMessage(null);
          setRestartNeeded(true);
          setRestartError(`Gateway restart failed with exit ${st.exit_code}.`);
          showToast(
            `Gateway restart failed (exit ${st.exit_code}) — restart manually`,
            "error",
          );
        } else {
          setRestartMessage(null);
          setRestartNeeded(false);
          setRestartError(null);
        }
        return;
      } catch {
        // The dashboard may briefly lose its connection while the gateway restarts.
      }
    }
    setRestartMessage(null);
  }, [showToast]);

  const handleRestart = useCallback(async () => {
    setRestarting(true);
    try {
      await api.restartGateway();
      setRestartNeeded(false);
      setRestartError(null);
      setRestartMessage("Gateway restarting…");
      showToast("Gateway restarting…", "success");
      setTimeout(() => void loadWebhooks(), 4000);
      void watchRestartOutcome();
    } catch (e) {
      setRestartNeeded(true);
      setRestartError(errorMessage(e));
      showToast(`Failed to restart: ${errorMessage(e)}`, "error");
    } finally {
      setRestarting(false);
    }
  }, [loadWebhooks, showToast, watchRestartOutcome]);

  const handleEnableWebhooks = useCallback(async () => {
    setEnabling(true);
    setRestartNeeded(false);
    setRestartError(null);
    try {
      const result = await api.enableWebhooks();
      await loadWebhooks();
      if (result.restart_started) {
        setRestartMessage("Webhooks enabled; gateway restarting…");
        showToast("Webhooks enabled; gateway restarting…", "success");
        setTimeout(() => void loadWebhooks(), 4000);
        void watchRestartOutcome();
      } else {
        const detail = result.restart_error ? `: ${result.restart_error}` : ".";
        setRestartMessage(null);
        setRestartNeeded(true);
        setRestartError(`Gateway restart failed${detail}`);
        showToast(`Webhooks enabled; gateway restart failed${detail}`, "error");
      }
    } catch (e) {
      showToast(`Failed to enable webhooks: ${errorMessage(e)}`, "error");
    } finally {
      setEnabling(false);
    }
  }, [loadWebhooks, showToast, watchRestartOutcome]);

  const handleCreate = async () => {
    if (!name.trim()) {
      setCreateError("Name required");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const eventsList = events
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);
      const res = await api.createWebhook({
        name: name.trim(),
        description: description.trim() || undefined,
        events: eventsList.length ? eventsList : undefined,
        deliver,
        deliver_only: deliverOnly,
        prompt: prompt.trim() || undefined,
      });
      showToast("Created ✓", "success");
      setCreated({ url: res.url, secret: res.secret });
      resetForm();
      loadWebhooks();
    } catch (e) {
      const detail = `Failed to create: ${errorMessage(e)}`;
      setCreateError(detail);
      showToast(detail, "error");
    } finally {
      setCreating(false);
    }
  };

  const [togglingName, setTogglingName] = useState<string | null>(null);

  const handleToggleEnabled = useCallback(
    async (subName: string, nextEnabled: boolean) => {
      setTogglingName(subName);
      try {
        await api.setWebhookEnabled(subName, nextEnabled);
        showToast(
          nextEnabled ? `Enabled: "${subName}"` : `Disabled: "${subName}"`,
          "success",
        );
        loadWebhooks();
      } catch (e) {
        showToast(`Error: ${errorMessage(e)}`, "error");
      } finally {
        setTogglingName(null);
      }
    },
    [loadWebhooks, showToast],
  );

  const webhookDelete = useConfirmDelete({
    onDelete: useCallback(
      async (name: string) => {
        try {
          await api.deleteWebhook(name);
          showToast(`Deleted: "${name}"`, "success");
          loadWebhooks();
        } catch (e) {
          showToast(`Error: ${errorMessage(e)}`, "error");
          throw e;
        }
      },
      [loadWebhooks, showToast],
    ),
  });

  // Put "New subscription" button in page header
  useLayoutEffect(() => {
    setEnd(
      <Button
        variant="primary"
        size="sm"
        disabled={!enabled || enabling}
        icon={<Plus />}
        onClick={() => {
          setCreated(null);
          setCreateModalOpen(true);
        }}
      >
        New subscription
      </Button>,
    );
    return () => {
      setEnd(null);
    };
  }, [setEnd, enabled, enabling, loading]);

  if (loading) {
    return (
      <div className="ui-surface">
        <LoadingState title="Loading webhooks…" />
      </div>
    );
  }

  const pendingName = webhookDelete.pendingId ?? "";

  return (
    <div className="flex flex-col gap-6">
      <Toast toast={toast} />

      <DeleteConfirmDialog
        open={webhookDelete.isOpen}
        onCancel={webhookDelete.cancel}
        onConfirm={webhookDelete.confirm}
        title="Delete webhook"
        description={
          pendingName
            ? `"${pendingName}" — this will permanently remove this webhook subscription.`
            : "This will permanently remove this webhook subscription."
        }
        loading={webhookDelete.isDeleting}
      />

      {/* Create subscription modal — fixed header, scrollable body, persistent footer */}
      <Modal
        open={createModalOpen}
        onClose={closeCreateModal}
        title="New subscription"
        size="lg"
        dirty={createDirty}
        pending={creating}
        closeLabel="Close"
        discardTitle="Discard changes?"
        discardDescription="You have unsaved changes. Closing now will lose them."
        discardConfirmLabel="Discard"
        discardCancelLabel="Keep editing"
        footerStatus={createError}
        statusTone={createError ? "error" : "muted"}
        footer={
          created ? (
            <ModalCancel variant="primary">Done</ModalCancel>
          ) : (
            <>
              <ModalCancel>Cancel</ModalCancel>
              <Button
                variant="primary"
                loading={creating}
                onClick={handleCreate}
              >
                {creating ? "Creating…" : "Create"}
              </Button>
            </>
          )
        }
      >
        {created ? (
          <>
            <p className="text-sm text-text-muted">
              Subscription created. Copy the secret now — it is only shown
              once.
            </p>

            <Field label="Webhook URL">
              <div className="flex items-center gap-2 rounded-md border border-border bg-[var(--ui-field-bg)] px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {created.url}
                </span>
                <CopyButton value={created.url} />
              </div>
            </Field>

            <Field label="Secret (shown once)">
              <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {created.secret}
                </span>
                <CopyButton value={created.secret} />
              </div>
            </Field>
          </>
        ) : (
          <>
            <Field label="Name" htmlFor="webhook-name">
              <TextInput
                id="webhook-name"
                autoFocus
                placeholder="e.g. github-push"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>

            <Field label="Description" htmlFor="webhook-description">
              <TextInput
                id="webhook-description"
                placeholder="What this webhook does (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>

            <Field label="Events" htmlFor="webhook-events">
              <TextInput
                id="webhook-events"
                placeholder="comma-separated, leave empty for all"
                value={events}
                onChange={(e) => setEvents(e.target.value)}
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Deliver to" htmlFor="webhook-deliver">
                <Select
                  id="webhook-deliver"
                  value={deliver}
                  onChange={(e) => setDeliver(e.target.value)}
                  options={[
                    { value: "log", label: "Log" },
                    { value: "telegram", label: "Telegram" },
                    { value: "discord", label: "Discord" },
                    { value: "slack", label: "Slack" },
                    { value: "email", label: "Email" },
                    { value: "github_comment", label: "GitHub comment" },
                  ]}
                />
              </Field>

              <div className="flex items-end pb-2">
                <label className="ui-check-row">
                  <input
                    id="webhook-deliver-only"
                    type="checkbox"
                    className="ui-checkbox"
                    checked={deliverOnly}
                    onChange={(e) => setDeliverOnly(e.target.checked)}
                  />
                  <span>Skip the agent, deliver payload directly</span>
                </label>
              </div>
            </div>

            <Field label="Prompt" htmlFor="webhook-prompt">
              <TextArea
                id="webhook-prompt"
                placeholder="Instructions for the agent when this webhook fires (optional)"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </Field>
          </>
        )}
      </Modal>

      {!enabled && (
        <div className="ui-surface border-warning/50">
          <div className="flex flex-col gap-4 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Webhook className="h-5 w-5 shrink-0 text-warning" />
              <div className="flex flex-col gap-1">
                <span className="font-medium">Webhook receiver disabled</span>
                <span className="text-text-muted">
                  Webhooks are their own gateway platform. Enable them here to
                  accept incoming HTTP events; chat channels are only needed
                  when a subscription delivers to Telegram, Discord, Slack, or
                  another channel.
                </span>
              </div>
            </div>
            <Button
              variant="primary"
              size="sm"
              className="shrink-0"
              onClick={handleEnableWebhooks}
              loading={enabling}
              icon={enabling ? undefined : <Webhook />}
            >
              {enabling ? "Enabling…" : "Enable webhooks"}
            </Button>
          </div>
        </div>
      )}

      {restartMessage && !restartNeeded && (
        <div className="ui-surface">
          <div className="flex items-center gap-2 p-4 text-sm text-text-muted">
            <RotateCw className="h-4 w-4 shrink-0 text-warning" />
            <span>{restartMessage}</span>
          </div>
        </div>
      )}

      {restartNeeded && (
        <div className="ui-surface border-warning/50">
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>
                {restartError ??
                  "Webhooks are enabled, but the gateway still needs a restart before the receiver can come online."}
              </span>
            </div>
            <Button
              variant="primary"
              size="sm"
              className="shrink-0"
              onClick={handleRestart}
              loading={restarting}
              icon={restarting ? undefined : <RotateCw />}
            >
              {restarting ? "Restarting…" : "Restart gateway"}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <SectionHeading count={subscriptions.length}>
          <span className="flex items-center gap-2">
            <Webhook className="h-4 w-4 text-text-muted" aria-hidden />
            Subscriptions
          </span>
        </SectionHeading>

        <p className="text-xs text-text-muted">
          Subscription changes hot-reload once the webhook receiver is running.
          Disabled subscriptions reject incoming events.
        </p>

        {subscriptions.length === 0 && (
          <div className="ui-surface">
            <EmptyState title="No webhook subscriptions yet." />
          </div>
        )}

        {subscriptions.length > 0 && (
          <ul className="ui-list">
            {subscriptions.map((sub: WebhookRoute) => (
              <li key={sub.name} className="ui-list-row">
                <div
                  className={
                    !sub.enabled
                      ? "ui-list-row__main opacity-60"
                      : "ui-list-row__main"
                  }
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="ui-list-row__title">{sub.name}</span>
                    <Badge>{sub.deliver}</Badge>
                    {sub.deliver_only && <Badge>deliver only</Badge>}
                    {!sub.enabled && <Badge tone="warning">disabled</Badge>}
                  </div>

                  {sub.description && (
                    <p className="mt-1 text-xs text-text-muted">
                      {sub.description}
                    </p>
                  )}

                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {sub.events.length === 0 ? (
                      <Badge>(all)</Badge>
                    ) : (
                      sub.events.map((evt) => <Badge key={evt}>{evt}</Badge>)
                    )}
                  </div>

                  <div className="mt-1.5 flex items-center gap-2 text-xs text-text-muted">
                    <span className="min-w-0 flex-1 truncate font-mono">
                      {sub.url}
                    </span>
                    <CopyButton value={sub.url} />
                  </div>
                </div>

                <div className="ui-list-row__actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={togglingName === sub.name}
                    onClick={() => handleToggleEnabled(sub.name, !sub.enabled)}
                  >
                    {sub.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    variant="danger-ghost"
                    size="icon-sm"
                    title="Delete"
                    aria-label="Delete"
                    onClick={() => webhookDelete.requestDelete(sub.name)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
