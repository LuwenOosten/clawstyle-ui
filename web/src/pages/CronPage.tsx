import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type CronTriggerController,
  createCronTriggerController,
} from "@hermes/shared";
import { Clock, Pause, Pencil, Play, Trash2, Zap } from "lucide-react";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { api } from "@/lib/api";
import type {
  CronJob,
  CronDeliveryTarget,
  ModelOptionsResult,
  ProfileInfo,
  SkillInfo,
  ToolsetInfo,
} from "@/lib/api";
import {
  buildCronJobPayload,
  cronJobHasExecutionContent,
  cronAgoLabel,
  cronNextRunOverdueMs,
  cronSchedulerStaleAgeS,
  cronJobFormFromJob,
  cronLastResult,
  focusCronField,
  type CronJobFormState,
} from "@/lib/cron-job";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import {
  DEFAULT_SCHEDULE_STATE,
  ScheduleBuilder,
} from "@/components/ScheduleBuilder";
import {
  buildScheduleString,
  describeSchedule,
  englishOrdinal,
  parseScheduleString,
  type ScheduleBuilderState,
  type ScheduleDescribeStrings,
} from "@/lib/schedule";
import { useToast } from "@nous-research/ui/hooks/use-toast";
import { useConfirmDelete } from "@nous-research/ui/hooks/use-confirm-delete";
import { Toast } from "@nous-research/ui/ui/components/toast";
import { useI18n } from "@/i18n";
import { en } from "@/i18n/en";
import { usePageHeader } from "@/contexts/usePageHeader";
import { PluginSlot } from "@/plugins";
import { LoadErrorNotice } from "@/components/LoadErrorNotice";
import { Segmented } from "@nous-research/ui/ui/components/segmented";
import { AutomationBlueprints } from "@/components/AutomationBlueprints";
import { errorMessage } from "@/lib/api-error";
import {
  Badge,
  Button as UiButton,
  Disclosure,
  EmptyState,
  Field,
  LoadingState,
  Modal,
  ModalCancel,
  SearchInput,
  SectionHeading,
  Select as UiSelect,
  TextArea,
  TextInput,
} from "@/ui";

function formatTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString();
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength
    ? value.slice(0, maxLength) + "..."
    : value;
}

function getJobPrompt(job: CronJob): string {
  return asText(job.prompt);
}

function NameCheckboxPicker({
  id,
  available,
  selected,
  onChange,
  emptyLabel,
  searchPlaceholder = "Search…",
}: {
  id: string;
  available: Array<{ name: string; description?: string | null }>;
  selected: string[];
  onChange: (names: string[]) => void;
  emptyLabel: string;
  searchPlaceholder?: string;
}) {
  const [query, setQuery] = useState("");
  const names = available.map((item) => item.name);
  const orphaned = selected.filter((s) => !names.includes(s));
  const all = [
    ...orphaned.map((name) => ({ name, description: "" })),
    ...available,
  ];

  if (all.length === 0) {
    return <p className="text-xs text-text-muted">{emptyLabel}</p>;
  }

  const toggle = (name: string, checked: boolean) => {
    if (checked) onChange([...selected, name]);
    else onChange(selected.filter((s) => s !== name));
  };

  const lowered = query.trim().toLowerCase();
  const visible = lowered
    ? all.filter(
        (item) =>
          item.name.toLowerCase().includes(lowered) ||
          (item.description ?? "").toLowerCase().includes(lowered),
      )
    : all;
  // Long catalogs get a filter so a 100-skill list stays usable.
  const searchable = all.length > 6;

  return (
    <div id={id} className="flex flex-col gap-2">
      {searchable && (
        <SearchInput
          className="max-w-xs"
          inputClassName="h-8 text-xs"
          placeholder={searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
          clearLabel="Clear"
        />
      )}
      <div className="max-h-40 overflow-y-auto rounded-md border border-border p-1">
        {visible.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-text-muted">
            No matches
          </p>
        ) : (
          visible.map((item) => (
            <label
              key={item.name}
              className="ui-check-row rounded px-2 py-1 text-xs hover:bg-accent"
              title={item.description || undefined}
            >
              <input
                type="checkbox"
                className="ui-checkbox"
                checked={selected.includes(item.name)}
                onChange={(e) => toggle(item.name, e.target.checked)}
              />
              <span className="truncate font-mono text-[11px]">
                {item.name}
              </span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

interface CronJobEditorState extends CronJobFormState {
  scheduleState: ScheduleBuilderState;
}

interface CronJobFormResources {
  availableSkills: SkillInfo[];
  availableToolsets: ToolsetInfo[];
  modelOptions: ModelOptionsResult | null;
  deliveryTargets: CronDeliveryTarget[];
}

function emptyCronJobForm(): CronJobEditorState {
  return {
    name: "",
    prompt: "",
    schedule: "",
    deliver: "local",
    skills: [],
    provider: "",
    model: "",
    base_url: "",
    script: "",
    no_agent: false,
    context_from: "",
    continuity: false,
    enabled_toolsets: [],
    workdir: "",
    scheduleState: { ...DEFAULT_SCHEDULE_STATE },
  };
}

function editorFormFromJob(job: CronJob): CronJobEditorState {
  const form = cronJobFormFromJob(job);
  return { ...form, scheduleState: parseScheduleString(form.schedule) };
}

function buildCronJobPayloadFromEditor(form: CronJobEditorState) {
  const { scheduleState, ...payloadForm } = form;
  return buildCronJobPayload({
    ...payloadForm,
    schedule: buildScheduleString(scheduleState),
  });
}

function selectOptions(
  current: string,
  options: Array<{ value: string; label: string }>,
): Array<{ value: string; label: string }> {
  const known = new Set(options.map((option) => option.value));
  return [
    ...options,
    ...(current && !known.has(current)
      ? [{ value: current, label: current }]
      : []),
  ];
}

function CronAdvancedFields({
  idPrefix,
  form,
  onChange,
  modelOptions,
  availableToolsets,
}: {
  idPrefix: string;
  form: CronJobEditorState;
  onChange: (form: CronJobEditorState) => void;
  modelOptions: ModelOptionsResult | null;
  availableToolsets: ToolsetInfo[];
}) {
  const update = <K extends keyof CronJobEditorState,>(
    key: K,
    next: CronJobEditorState[K],
  ) => {
    onChange({ ...form, [key]: next });
  };

  const providers = (modelOptions?.providers ?? []).filter(
    (p) => p.authenticated !== false,
  );
  const selectedProvider = providers.find((p) => p.slug === form.provider);
  const models = selectedProvider?.models ?? [];

  return (
    <Disclosure summary="Advanced options">
      <div className="grid gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Provider" htmlFor={`${idPrefix}-provider`}>
            <UiSelect
              id={`${idPrefix}-provider`}
              value={form.provider}
              onChange={(e) => {
                onChange({ ...form, provider: e.target.value, model: "" });
              }}
              options={[
                { value: "", label: "Default" },
                ...selectOptions(
                  form.provider,
                  providers.map((p) => ({ value: p.slug, label: p.name })),
                ),
              ]}
            />
          </Field>
          <Field label="Model" htmlFor={`${idPrefix}-model`}>
            <UiSelect
              id={`${idPrefix}-model`}
              value={form.model}
              onChange={(e) => update("model", e.target.value)}
              options={[
                { value: "", label: "Default" },
                ...selectOptions(
                  form.model,
                  models.map((model) => ({ value: model, label: model })),
                ),
              ]}
            />
          </Field>
        </div>

        <Field label="Base URL override" htmlFor={`${idPrefix}-base-url`}>
          <TextInput
            id={`${idPrefix}-base-url`}
            placeholder="https://api.example.com/v1"
            value={form.base_url}
            onChange={(e) => update("base_url", e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Script" htmlFor={`${idPrefix}-script`}>
            <TextInput
              id={`${idPrefix}-script`}
              value={form.script}
              onChange={(e) => update("script", e.target.value)}
              placeholder="relative/path/in/scripts"
            />
          </Field>
          <div className="flex items-end">
            <label className="ui-check-row">
              <input
                type="checkbox"
                className="ui-checkbox"
                checked={form.no_agent}
                onChange={(e) => update("no_agent", e.target.checked)}
              />
              <span>
                no_agent: run the script only and deliver stdout verbatim
              </span>
            </label>
          </div>
        </div>

        <Field label="Workdir" htmlFor={`${idPrefix}-workdir`}>
          <TextInput
            id={`${idPrefix}-workdir`}
            value={form.workdir}
            onChange={(e) => update("workdir", e.target.value)}
            placeholder="/absolute/project/path"
          />
        </Field>

        <label className="ui-check-row">
          <input
            type="checkbox"
            className="ui-checkbox"
            checked={form.continuity}
            onChange={(e) => update("continuity", e.target.checked)}
          />
          <span>
            continuity: each run sees the previous run&apos;s output (dedupe,
            pick up where it left off)
          </span>
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="context_from job IDs" htmlFor={`${idPrefix}-context-from`}>
            <TextArea
              id={`${idPrefix}-context-from`}
              className="min-h-[64px] text-xs"
              placeholder="one job id per line"
              value={form.context_from}
              onChange={(e) => update("context_from", e.target.value)}
            />
          </Field>
          <Field label="enabled_toolsets" htmlFor={`${idPrefix}-toolsets`}>
            <NameCheckboxPicker
              id={`${idPrefix}-toolsets`}
              available={availableToolsets}
              selected={form.enabled_toolsets}
              onChange={(v) => update("enabled_toolsets", v)}
              emptyLabel="No toolsets available."
            />
          </Field>
        </div>
      </div>
    </Disclosure>
  );
}

interface CronJobFormFieldsProps {
  idPrefix: string;
  autoFocus?: boolean;
  form: CronJobEditorState;
  resources: CronJobFormResources;
  onChange: (form: CronJobEditorState) => void;
}

function CronJobFormFields({
  idPrefix,
  autoFocus,
  form,
  resources,
  onChange,
}: CronJobFormFieldsProps) {
  const { t } = useI18n();
  const { availableSkills, availableToolsets, deliveryTargets, modelOptions } = resources;
  const update = <K extends keyof CronJobEditorState,>(
    key: K,
    next: CronJobEditorState[K],
  ) => {
    onChange({ ...form, [key]: next });
  };
  const onlyLocalAvailable =
    deliveryTargets.filter((target) => target.id !== "local").length === 0;

  const deliveryOptions = selectOptions(
    form.deliver,
    deliveryTargets.map((target) => {
      const base = target.id === "local" ? t.cron.delivery.local : target.name;
      if (target.id !== "local" && !target.home_target_set) {
        const hint = t.cron.delivery.needsHomeChannel ?? "set a home channel first";
        return { value: target.id, label: `${base} — ${hint}` };
      }
      return { value: target.id, label: base };
    }),
  );

  return (
    <div className="flex flex-col gap-4">
      <Field label={t.cron.nameOptional} htmlFor={`${idPrefix}-name`}>
        <TextInput
          id={`${idPrefix}-name`}
          autoFocus={autoFocus}
          data-autofocus={autoFocus || undefined}
          placeholder={t.cron.namePlaceholder}
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
        />
      </Field>

      <Field label={t.cron.prompt} htmlFor={`${idPrefix}-prompt`}>
        <TextArea
          id={`${idPrefix}-prompt`}
          placeholder={t.cron.promptPlaceholder}
          value={form.prompt}
          onChange={(e) => update("prompt", e.target.value)}
        />
      </Field>

      <ScheduleBuilder
        value={form.scheduleState}
        onChange={(state) => update("scheduleState", state)}
      />

      <Field label={t.cron.deliverTo} htmlFor={`${idPrefix}-deliver`}>
        <UiSelect
          id={`${idPrefix}-deliver`}
          value={form.deliver}
          onChange={(e) => update("deliver", e.target.value)}
          options={deliveryOptions}
        />
        {onlyLocalAvailable && (
          <p className="text-xs text-text-muted">
            {t.cron.delivery.noneConfigured ??
              "No messaging platforms configured. Set one up under Channels to deliver reports."}
          </p>
        )}
      </Field>

      <Field label="Skills (optional)" htmlFor={`${idPrefix}-skills`}>
        <NameCheckboxPicker
          id={`${idPrefix}-skills`}
          available={availableSkills}
          selected={form.skills}
          onChange={(skills) => update("skills", skills)}
          emptyLabel="No skills installed for this profile."
        />
        <p className="text-xs text-text-muted">
          Selected skills are loaded before the prompt runs — the cron sets
          when, the skill sets how.
        </p>
      </Field>

      <CronAdvancedFields
        idPrefix={`${idPrefix}-advanced`}
        form={form}
        onChange={onChange}
        modelOptions={modelOptions}
        availableToolsets={availableToolsets}
      />
    </div>
  );
}

function getJobName(job: CronJob): string {
  return asText(job.name).trim();
}

function getJobTitle(job: CronJob): string {
  const name = getJobName(job);
  if (name) return name;

  const prompt = getJobPrompt(job);
  if (prompt) return truncateText(prompt, 60);

  const script = asText(job.script);
  if (script) return truncateText(script, 60);

  return job.id || "Cron job";
}

function getJobScheduleDisplay(
  job: CronJob,
  strings: ScheduleDescribeStrings,
): string {
  // Prefer a structured render so cron expressions like
  // ``30 14 * * 1,3,5`` surface as "Weekly on Mon, Wed, Fri at 14:30"
  // in the list instead of the raw five-field gibberish. Falls back
  // through the existing chain (``schedule_display`` from the backend,
  // then the structured ``display`` field, then the raw ``expr``) so
  // legacy job rows still render *something* meaningful.
  return describeSchedule(
    job.schedule,
    asText(job.schedule_display) || asText(job.schedule?.display),
    strings,
  );
}

function getJobState(job: CronJob): string {
  return asText(job.state) || (job.enabled === false ? "disabled" : "scheduled");
}

function getRepeatDisplay(job: CronJob): string {
  const repeat = job.repeat;
  if (!repeat || repeat.times == null) return "forever";
  const completed = repeat.completed ?? 0;
  return completed > 0 ? `${completed}/${repeat.times}` : `${repeat.times} times`;
}

function getJobMode(job: CronJob): string {
  if (job.no_agent) return "no_agent";
  if (job.script) return "script+agent";
  return "agent";
}

function getModelDisplay(job: CronJob): string {
  const provider = asText(job.provider);
  const model = asText(job.model);
  if (provider && model) return `${provider}/${model}`;
  return model || provider;
}

function getJobProfile(job: CronJob): string {
  return asText(job.profile) || asText(job.profile_name) || "default";
}

function getJobKey(job: CronJob): string {
  return `${getJobProfile(job)}:${job.id}`;
}

function splitJobKey(key: string): { profile: string; id: string } {
  const idx = key.indexOf(":");
  if (idx === -1) return { profile: "default", id: key };
  return { profile: key.slice(0, idx) || "default", id: key.slice(idx + 1) };
}

function profileLabel(profile: string): string {
  return profile === "default" ? "default" : profile;
}

const STATUS_TONE: Record<string, "success" | "warning" | "destructive"> = {
  enabled: "success",
  scheduled: "success",
  paused: "warning",
  error: "destructive",
  completed: "destructive",
};

function stateBadgeTone(state: string): "accent" | "warning" | "danger" {
  const tone = STATUS_TONE[state];
  if (tone === "warning") return "warning";
  if (tone === "destructive") return "danger";
  return "accent";
}

function resultBadgeTone(tone: string): "accent" | "warning" | "danger" {
  if (tone === "success") return "accent";
  if (tone === "warning") return "warning";
  return "danger";
}

export default function CronPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const schedulerStaleAgeS = cronSchedulerStaleAgeS(jobs);
  const [triggeringJobKeys, setTriggeringJobKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const triggerControllerRef = useRef<CronTriggerController | null>(null);

  useEffect(() => {
    const controller = createCronTriggerController((key, running) => {
      if (triggerControllerRef.current !== controller) return;
      setTriggeringJobKeys((current) => {
        const next = new Set(current);
        if (running) next.add(key);
        else next.delete(key);
        return next;
      });
    });
    triggerControllerRef.current = controller;

    return () => {
      triggerControllerRef.current = null;
    };
  }, []);
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [selectedProfile, setSelectedProfile] = useState("all");
  const [view, setView] = useState<"jobs" | "blueprints">("jobs");
  const [loading, setLoading] = useState(true);
  const { toast, showToast } = useToast();
  const { t, locale } = useI18n();
  const { setEnd } = usePageHeader();

  // Translation surface for the human-readable schedule describer.
  // English ordinals are a special case ("1st", "2nd", "23rd"); every
  // other locale falls back to the plain numeric form, which avoids
  // shipping incorrect grammar (e.g. naive "1th"/"2th" suffixes that
  // don't exist in most languages).
  //
  // Built inline (not memoized) — the cron page renders a small job
  // list, this is single-digit microseconds, and a useMemo here would
  // just add boilerplate.
  const scheduleDescribeStrings: ScheduleDescribeStrings = {
    ...t.cron.scheduleDescribe,
    weekdaysShort: t.cron.scheduleModes.weekdaysShort,
    ordinal: locale === "en" ? englishOrdinal : (n: number) => String(n),
  };

  // New job modal state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createProfile, setCreateProfile] = useState("default");
  const [createForm, setCreateForm] = useState<CronJobEditorState>(
    emptyCronJobForm,
  );
  const [createError, setCreateError] = useState<string | null>(null);
  const closeCreateModal = useCallback(() => {
    // Called for every dismissal (Cancel via ModalCancel, Escape, backdrop,
    // close button, discard confirmation, or successful create). Resetting
    // here is what makes an explicitly discarded draft stay discarded when
    // the dialog is reopened.
    setCreateModalOpen(false);
    setCreateForm(emptyCronJobForm());
    setCreateError(null);
  }, []);
  const [deliveryTargets, setDeliveryTargets] = useState<CronDeliveryTarget[]>([
    { id: "local", name: "Local", home_target_set: true, home_env_var: null },
  ]);
  const [creating, setCreating] = useState(false);

  // Edit job modal state
  const [editJob, setEditJob] = useState<CronJob | null>(null);
  const [editForm, setEditForm] = useState<CronJobEditorState>(
    emptyCronJobForm,
  );
  const [editBaseline, setEditBaseline] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const closeEditModal = useCallback(() => {
    setEditJob(null);
    setEditError(null);
  }, []);

  const createDirty = useMemo(
    () => JSON.stringify(createForm) !== JSON.stringify(emptyCronJobForm()),
    [createForm],
  );
  const editDirty = useMemo(
    () => editBaseline !== null && JSON.stringify(editForm) !== editBaseline,
    [editForm, editBaseline],
  );

  // Skills installed in the profile a job will run under, for the
  // attach-skill selector (parity with `hermes cron edit --add-skill`).
  // Keyed on the create-modal profile; the edit modal reuses the list —
  // a job's current skills are always shown even if not in it.
  const [availableSkills, setAvailableSkills] = useState<SkillInfo[]>([]);
  const [availableToolsets, setAvailableToolsets] = useState<ToolsetInfo[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelOptionsResult | null>(null);

  const resourceProfile = editJob ? getJobProfile(editJob) : createProfile;

  const openEditModal = useCallback((job: CronJob) => {
    const form = editorFormFromJob(job);
    setEditJob(job);
    setEditForm(form);
    setEditBaseline(JSON.stringify(form));
    setEditError(null);
  }, []);

  const selectedProfileRef = useRef(selectedProfile);
  const jobsRequestGenerationRef = useRef(0);
  const jobsActiveRef = useRef(false);
  // Humanized error from the last GET /api/cron/jobs failure; renders a
  // persistent Retry notice instead of a vanishing toast.
  const [jobsLoadError, setJobsLoadError] = useState<string | null>(null);

  const loadJobs = useCallback((profile: string) => {
    if (!jobsActiveRef.current || selectedProfileRef.current !== profile) return;

    const generation = ++jobsRequestGenerationRef.current;

    api
      .getCronJobs(profile)
      .then((nextJobs) => {
        if (
          jobsRequestGenerationRef.current === generation &&
          selectedProfileRef.current === profile
        ) {
          setJobs(nextJobs);
          setJobsLoadError(null);
        }
      })
      .catch((e: unknown) => {
        if (
          jobsRequestGenerationRef.current === generation &&
          selectedProfileRef.current === profile
        ) {
          setJobsLoadError(errorMessage(e));
        }
      })
      .finally(() => {
        if (
          jobsRequestGenerationRef.current === generation &&
          selectedProfileRef.current === profile
        ) setLoading(false);
      });
  }, []);

  useEffect(() => {
    api
      .getProfiles()
      .then((res) => setProfiles(res.profiles))
      .catch(() => setProfiles([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .getCronDeliveryTargets(resourceProfile)
      .then((res) => {
        if (!cancelled) setDeliveryTargets(res.targets);
      })
      .catch(() => {
        // Fall back to local-only so the modal still works if the endpoint fails.
        if (!cancelled) {
          setDeliveryTargets([
            { id: "local", name: "Local", home_target_set: true, home_env_var: null },
          ]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [resourceProfile]);

  useEffect(() => {
    jobsActiveRef.current = true;
    selectedProfileRef.current = selectedProfile;
    loadJobs(selectedProfile);

    return () => {
      jobsActiveRef.current = false;
      jobsRequestGenerationRef.current += 1;
    };
  }, [loadJobs, selectedProfile]);

  // Load resources from the profile the create/edit form actually targets.
  // Pass "default" explicitly so the global dashboard profile switch cannot
  // redirect a default-profile cron form to some other profile.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getSkills(resourceProfile).catch(() => []),
      api.getToolsets(resourceProfile).catch(() => []),
      api.getModelOptions(resourceProfile).catch(() => null),
    ]).then(([skills, toolsets, options]) => {
      if (cancelled) return;
      setAvailableSkills([...skills].sort((a, b) => a.name.localeCompare(b.name)));
      setAvailableToolsets([...toolsets].sort((a, b) => a.name.localeCompare(b.name)));
      setModelOptions(options);
    });
    return () => {
      cancelled = true;
    };
  }, [resourceProfile]);

  const handleCreate = async () => {
    const payload = buildCronJobPayloadFromEditor(createForm);
    if (
      !payload.schedule ||
      (!payload.no_agent && !cronJobHasExecutionContent(payload))
    ) {
      setCreateError(`${t.cron.prompt} & ${t.cron.schedule} required`);
      return;
    }
    if (payload.no_agent && !payload.script) {
      setCreateError(t.cron.scriptRequired ?? en.cron.scriptRequired!);
      focusCronField("cron-script");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await api.createCronJob(payload, createProfile);
      showToast(t.common.create + " ✓", "success");
      setCreateForm(emptyCronJobForm());
      setCreateModalOpen(false);
      loadJobs(selectedProfile);
    } catch (e) {
      const detail = `${t.config.failedToSave}: ${errorMessage(e)}`;
      setCreateError(detail);
      showToast(detail, "error");
    } finally {
      setCreating(false);
    }
  };

  const handleEdit = async () => {
    if (!editJob) return;
    const payload = buildCronJobPayloadFromEditor(editForm);
    if (
      !payload.schedule ||
      (!payload.no_agent && cronJobHasExecutionContent(payload) === false)
    ) {
      setEditError(`${t.cron.prompt} & ${t.cron.schedule} required`);
      return;
    }
    if (payload.no_agent && !payload.script) {
      setEditError(t.cron.scriptRequired ?? en.cron.scriptRequired!);
      focusCronField("edit-cron-script");
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      await api.updateCronJob(
        editJob.id,
        payload,
        getJobProfile(editJob),
      );
      showToast("Saved changes ✓", "success");
      setEditJob(null);
      loadJobs(selectedProfile);
    } catch (e) {
      const detail = `${t.config.failedToSave}: ${errorMessage(e)}`;
      setEditError(detail);
      showToast(detail, "error");
    } finally {
      setSaving(false);
    }
  };

  const handlePauseResume = async (job: CronJob) => {
    try {
      const isPaused = getJobState(job) === "paused";
      const profile = getJobProfile(job);
      if (isPaused) {
        await api.resumeCronJob(job.id, profile);
        showToast(
          `${t.cron.resume}: "${truncateText(getJobTitle(job), 30)}"`,
          "success",
        );
      } else {
        await api.pauseCronJob(job.id, profile);
        showToast(
          `${t.cron.pause}: "${truncateText(getJobTitle(job), 30)}"`,
          "success",
        );
      }
      loadJobs(selectedProfile);
    } catch (e) {
      showToast(`${t.status.error}: ${errorMessage(e)}`, "error");
    }
  };

  const handleTrigger = async (job: CronJob) => {
    const jobKey = getJobKey(job);
    const label = `${t.cron.triggerNow}: "${truncateText(getJobTitle(job), 30)}"`;
    const viewProfile = selectedProfile;
    const controller = triggerControllerRef.current;

    if (!controller) return;

    try {
      // No pre-request toast: the controller's running state already gives
      // immediate in-progress feedback (disabled + spinning action), and a
      // success-styled toast before the HTTP response would claim a result
      // the request has not produced yet. Terminal feedback only.
      const result = await controller.run(
        jobKey,
        () => api.triggerCronJob(job.id, getJobProfile(job)),
      );

      if (
        triggerControllerRef.current !== controller ||
        selectedProfileRef.current !== viewProfile ||
        !result.started
      ) return;

      showToast(`${label} ✓`, "success");
      loadJobs(viewProfile);
    } catch (e) {
      if (
        triggerControllerRef.current === controller &&
        selectedProfileRef.current === viewProfile
      ) {
        showToast(`${t.status.error}: ${errorMessage(e)}`, "error");
      }
    }
  };

  const jobDelete = useConfirmDelete({
    onDelete: useCallback(
      async (key: string) => {
        const { profile, id } = splitJobKey(key);
        const job = jobs.find((j) => getJobKey(j) === key);
        try {
          await api.deleteCronJob(id, profile);
          showToast(
            `${t.common.delete}: "${job ? truncateText(getJobTitle(job), 30) : id}"`,
            "success",
          );
          loadJobs(selectedProfile);
        } catch (e) {
          showToast(`${t.status.error}: ${errorMessage(e)}`, "error");
          throw e;
        }
      },
      [jobs, loadJobs, selectedProfile, showToast, t.common.delete, t.status.error],
    ),
  });

  // Put "Create" button in page header
  useLayoutEffect(() => {
    setEnd(
      <UiButton
        variant="primary"
        size="sm"
        onClick={() => {
          setCreateProfile(selectedProfile === "all" ? "default" : selectedProfile);
          setCreateModalOpen(true);
        }}
      >
        {t.common.create}
      </UiButton>,
    );
    return () => {
      setEnd(null);
    };
  }, [setEnd, t.common.create, loading, selectedProfile]);

  if (loading) {
    return (
      <div className="ui-surface">
        <LoadingState title={t.common.loading} />
      </div>
    );
  }

  const pendingJob = jobDelete.pendingId
    ? jobs.find((j) => getJobKey(j) === jobDelete.pendingId)
    : null;

  return (
    <div className="flex flex-col gap-6">
      <PluginSlot name="cron:top" />
      <Toast toast={toast} />

      {jobsLoadError && (
        <LoadErrorNotice
          what={t.cron.loadWhat ?? en.cron.loadWhat!}
          detail={jobsLoadError}
          onRetry={() => loadJobs(selectedProfile)}
        />
      )}

      {schedulerStaleAgeS !== null && (
        <p className="text-sm text-warning font-medium" data-testid="cron-scheduler-stale">
          {(t.cron.schedulerLastTicked ?? en.cron.schedulerLastTicked!).replace(
            "{when}",
            cronAgoLabel(schedulerStaleAgeS),
          )}
        </p>
      )}

      <Segmented
        value={view}
        onChange={(v) => setView(v as "jobs" | "blueprints")}
        options={[
          { value: "jobs", label: "Jobs" },
          { value: "blueprints", label: "Blueprints" },
        ]}
      />

      {view === "blueprints" && (
        <AutomationBlueprints
          profile={selectedProfile === "all" ? "default" : selectedProfile}
          onCreated={() => loadJobs(selectedProfile)}
        />
      )}


      <DeleteConfirmDialog
        open={jobDelete.isOpen}
        onCancel={jobDelete.cancel}
        onConfirm={jobDelete.confirm}
        title={t.cron.confirmDeleteTitle}
        description={
          pendingJob
            ? `"${truncateText(getJobTitle(pendingJob), 40)}" — ${
                t.cron.confirmDeleteMessage
              }`
            : t.cron.confirmDeleteMessage
        }
        loading={jobDelete.isDeleting}
      />

      {/* Create job modal — fixed header, scrollable body, persistent footer */}
      <Modal
        open={createModalOpen}
        onClose={closeCreateModal}
        title={t.cron.newJob}
        size="xl"
        dirty={createDirty}
        pending={creating}
        closeLabel={t.common.close}
        discardTitle={
          t.common.discardChangesTitle ?? en.common.discardChangesTitle!
        }
        discardDescription={
          t.common.discardChangesMessage ?? en.common.discardChangesMessage!
        }
        discardConfirmLabel={t.common.discard ?? en.common.discard!}
        discardCancelLabel={t.common.keepEditing ?? en.common.keepEditing!}
        footerStatus={createError}
        statusTone={createError ? "error" : "muted"}
        footer={
          <>
            <ModalCancel>{t.common.cancel}</ModalCancel>
            <UiButton
              variant="primary"
              loading={creating}
              onClick={handleCreate}
            >
              {creating ? t.common.creating : t.common.create}
            </UiButton>
          </>
        }
      >
        <Field label="Profile" htmlFor="cron-profile">
          <UiSelect
            id="cron-profile"
            value={createProfile}
            onChange={(e) => setCreateProfile(e.target.value)}
            options={profiles.map((profile) => ({
              value: profile.name,
              label: profileLabel(profile.name),
            }))}
          />
        </Field>

        <CronJobFormFields
          idPrefix="cron"
          autoFocus
          form={createForm}
          onChange={setCreateForm}
          resources={{
            availableSkills,
            availableToolsets,
            modelOptions,
            deliveryTargets,
          }}
        />
      </Modal>

      {/* Edit job modal */}
      <Modal
        open={editJob !== null}
        onClose={closeEditModal}
        title="Edit job"
        description={
          editJob ? (
            <span className="font-mono text-[11px]">{editJob.id}</span>
          ) : undefined
        }
        size="xl"
        dirty={editDirty}
        pending={saving}
        closeLabel={t.common.close}
        discardTitle={
          t.common.discardChangesTitle ?? en.common.discardChangesTitle!
        }
        discardDescription={
          t.common.discardChangesMessage ?? en.common.discardChangesMessage!
        }
        discardConfirmLabel={t.common.discard ?? en.common.discard!}
        discardCancelLabel={t.common.keepEditing ?? en.common.keepEditing!}
        footerStatus={editError}
        statusTone={editError ? "error" : "muted"}
        footer={
          <>
            <ModalCancel>{t.common.cancel}</ModalCancel>
            <UiButton variant="primary" loading={saving} onClick={handleEdit}>
              {saving ? t.common.loading : "Save changes"}
            </UiButton>
          </>
        }
      >
        <CronJobFormFields
          idPrefix="edit-cron"
          autoFocus
          form={editForm}
          onChange={setEditForm}
          resources={{
            availableSkills,
            availableToolsets,
            modelOptions,
            deliveryTargets,
          }}
        />
      </Modal>

      {view === "jobs" && (
      <div className="flex flex-col gap-3">
        <SectionHeading
          count={jobs.length}
          actions={
            <UiSelect
              id="cron-profile-filter"
              aria-label="Profile"
              value={selectedProfile}
              onChange={(e) => setSelectedProfile(e.target.value)}
              className="min-w-[180px]"
              options={[
                { value: "all", label: "All profiles" },
                ...profiles.map((profile) => ({
                  value: profile.name,
                  label: profileLabel(profile.name),
                })),
              ]}
            />
          }
        >
          <span className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-text-muted" aria-hidden />
            {t.cron.scheduledJobs}
          </span>
        </SectionHeading>

        {jobs.length === 0 && !jobsLoadError && (
          <div className="ui-surface">
            <EmptyState
              title={t.cron.noJobs}
              action={
                <UiButton
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setCreateProfile(
                      selectedProfile === "all" ? "default" : selectedProfile,
                    );
                    setCreateModalOpen(true);
                  }}
                >
                  {t.common.create}
                </UiButton>
              }
            />
          </div>
        )}

        {jobs.length > 0 && (
        <ul className="ui-list">
        {jobs.map((job) => {
          const state = getJobState(job);
          const promptText = getJobPrompt(job);
          const title = getJobTitle(job);
          const hasName = Boolean(getJobName(job));
          const deliver = asText(job.deliver);
          const profile = getJobProfile(job);
          const jobKey = getJobKey(job);
          const mode = getJobMode(job);
          const modelDisplay = getModelDisplay(job);
          const toolsets = Array.isArray(job.enabled_toolsets)
            ? job.enabled_toolsets.filter(Boolean)
            : [];
          const lastResult = cronLastResult(job);

          return (
            <li key={jobKey} className="ui-list-row">
                <div className="ui-list-row__main">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <span className="ui-list-row__title">{title}</span>
                    <Badge tone={stateBadgeTone(state)}>{state}</Badge>
                    {lastResult && lastResult.status !== "ok" && (
                      <Badge
                        tone={resultBadgeTone(lastResult.tone)}
                        title={lastResult.detail ?? undefined}
                        data-testid="cron-last-result"
                      >
                        {lastResult.status}
                      </Badge>
                    )}
                    <Badge>{profileLabel(profile)}</Badge>
                    {deliver && deliver !== "local" && (
                      <Badge>{deliver}</Badge>
                    )}
                    {Array.isArray(job.skills) && job.skills.length > 0 && (
                      <Badge title={job.skills.join(", ")}>
                        {job.skills.length === 1
                          ? job.skills[0]
                          : `${job.skills.length} skills`}
                      </Badge>
                    )}
                    {mode !== "agent" && <Badge>{mode}</Badge>}
                    {modelDisplay && <Badge title={modelDisplay}>model</Badge>}
                    {toolsets.length > 0 && (
                      <Badge title={toolsets.join(", ")}>
                        {toolsets.length} toolsets
                      </Badge>
                    )}
                  </div>
                  {hasName && promptText && (
                    <p className="mb-1 truncate text-xs text-text-muted">
                      {truncateText(promptText, 100)}
                    </p>
                  )}
                  <div className="ui-list-row__meta">
                    <span className="font-mono-ui">
                      {getJobScheduleDisplay(job, scheduleDescribeStrings)}
                    </span>
                    <span>repeat: {getRepeatDisplay(job)}</span>
                    <span>
                      {t.cron.last}: {formatTime(job.last_run_at)}
                    </span>
                    {cronNextRunOverdueMs(job) === null ? (
                      <span>
                        {t.cron.next}: {formatTime(job.next_run_at)}
                      </span>
                    ) : (
                      <span
                        className="text-warning font-medium"
                        data-testid="cron-next-run-overdue"
                      >
                        {t.cron.overdueSince ?? en.cron.overdueSince!}: {formatTime(job.next_run_at)}
                      </span>
                    )}
                  </div>
                  {job.last_delivery_error && (
                    <p className="text-xs text-destructive mt-1">
                      delivery: {job.last_delivery_error}
                    </p>
                  )}
                  {job.last_fire_error?.detail && (
                    <p className="text-xs text-destructive mt-1">
                      missed scheduled fire ({formatTime(job.last_fire_error.at ?? null)}):{" "}
                      {job.last_fire_error.detail}
                    </p>
                  )}
                  {job.last_error && (
                    <p className="text-xs text-destructive mt-1">
                      {job.last_error}
                    </p>
                  )}
                </div>

                <div className="ui-list-row__actions">
                  <UiButton
                    variant="ghost"
                    size="icon-sm"
                    title={state === "paused" ? t.cron.resume : t.cron.pause}
                    aria-label={
                      state === "paused" ? t.cron.resume : t.cron.pause
                    }
                    onClick={() => handlePauseResume(job)}
                    className={
                      state === "paused" ? "text-success" : "text-warning"
                    }
                  >
                    {state === "paused" ? <Play /> : <Pause />}
                  </UiButton>

                  <UiButton
                    variant="ghost"
                    size="icon-sm"
                    disabled={triggeringJobKeys.has(jobKey)}
                    title={t.cron.triggerNow}
                    aria-label={t.cron.triggerNow}
                    onClick={() => handleTrigger(job)}
                  >
                    {triggeringJobKeys.has(jobKey) ? <Spinner /> : <Zap />}
                  </UiButton>

                  <UiButton
                    variant="ghost"
                    size="icon-sm"
                    title="Edit job"
                    aria-label="Edit job"
                    onClick={() => openEditModal(job)}
                  >
                    <Pencil />
                  </UiButton>

                  <UiButton
                    variant="danger-ghost"
                    size="icon-sm"
                    title={t.common.delete}
                    aria-label={t.common.delete}
                    onClick={() => jobDelete.requestDelete(jobKey)}
                  >
                    <Trash2 />
                  </UiButton>
                </div>
            </li>
          );
        })}
        </ul>
        )}
      </div>
      )}

      <PluginSlot name="cron:bottom" />
    </div>
  );
}
