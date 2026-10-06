import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
  type ReactNode,
} from "react";
import {
  Code,
  Download,
  FormInput,
  RotateCcw,
  Upload,
  Settings2,
  FileText,
  Settings,
  Bot,
  Monitor,
  Palette,
  Users,
  Brain,
  Package,
  Lock,
  Globe,
  Mic,
  Volume2,
  Ear,
  ClipboardList,
  MessageCircle,
  Wrench,
  FileQuestion,
  Filter,
  Cloud,
  Sparkles,
  LayoutDashboard,
  BookOpen,
  Route,
  History,
  Shield,
  FileOutput,
  RefreshCw,
} from "lucide-react";
import { api } from "@/lib/api";
import { getNestedValue, setNestedValue } from "@/lib/nested";
import { applyScopedReset } from "@/lib/config-reset";
import { useToast } from "@nous-research/ui/hooks/use-toast";
import { Toast } from "@nous-research/ui/ui/components/toast";
import { AutoField } from "@/components/AutoField";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useI18n } from "@/i18n";
import { usePageHeader } from "@/contexts/usePageHeader";
import { useProfileScope } from "@/contexts/useProfileScope";
import {
  clearConfigDraft,
  configDraftKey,
  readConfigDraft,
  writeConfigDraft,
} from "@/lib/config-draft";
import { PluginSlot } from "@/plugins";
import { errorMessage } from "@/lib/api-error";
import {
  Badge,
  Button,
  EmptyState,
  NoMatchState,
  SearchInput,
  Select,
  SettingsGroup,
  SettingsSection,
  StatusText,
} from "@/ui";
import { en } from "@/i18n/en";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const CATEGORY_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  general: Settings,
  agent: Bot,
  terminal: Monitor,
  display: Palette,
  delegation: Users,
  memory: Brain,
  compression: Package,
  security: Lock,
  browser: Globe,
  voice: Mic,
  tts: Volume2,
  stt: Ear,
  logging: ClipboardList,
  discord: MessageCircle,
  auxiliary: Wrench,
  bedrock: Cloud,
  curator: Sparkles,
  kanban: LayoutDashboard,
  model_catalog: BookOpen,
  openrouter: Route,
  sessions: History,
  tool_loop_guardrails: Shield,
  tool_output: FileOutput,
  updates: RefreshCw,
};

function CategoryIcon({
  category,
  className,
}: {
  category: string;
  className?: string;
}) {
  const Icon = CATEGORY_ICONS[category] ?? FileQuestion;
  return <Icon className={className ?? "h-4 w-4"} />;
}

function humanizeSection(section: string): string {
  const spaced = section.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ConfigPage() {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [schema, setSchema] = useState<Record<
    string,
    Record<string, unknown>
  > | null>(null);
  const [categoryOrder, setCategoryOrder] = useState<string[]>([]);
  const [defaults, setDefaults] = useState<Record<string, unknown> | null>(
    null,
  );
  const [savedJson, setSavedJson] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [yamlMode, setYamlMode] = useState(false);
  const [yamlText, setYamlText] = useState("");
  const [yamlLoading, setYamlLoading] = useState(false);
  const [yamlSaving, setYamlSaving] = useState(false);
  const [yamlDirty, setYamlDirty] = useState(false);
  const [configPath, setConfigPath] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmYamlSwitch, setConfirmYamlSwitch] = useState(false);
  const [confirmYamlDiscard, setConfirmYamlDiscard] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const { toast, showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();
  const { setEnd } = usePageHeader();
  const { profile, currentProfile } = useProfileScope();
  const draftKey = useMemo(
    () => configDraftKey(profile || currentProfile),
    [profile, currentProfile],
  );
  // A restored dirty YAML draft must not be clobbered by the lazy server
  // fetch that normally seeds the YAML editor.
  const skipYamlLoadRef = useRef(false);

  const dirty = useMemo(
    () =>
      config !== null &&
      savedJson !== null &&
      JSON.stringify(config) !== savedJson,
    [config, savedJson],
  );

  // Latest draft state for the unmount flush below — a cleanup closure would
  // otherwise capture the first render's values.
  const draftStateRef = useRef({
    config,
    savedJson,
    dirty,
    yamlText,
    yamlDirty,
    yamlMode,
    activeCategory,
  });
  // Sync after every render (never during it): ref mutation during render is
  // not allowed, and the flush effect below runs after this one.
  useEffect(() => {
    draftStateRef.current = {
      config,
      savedJson,
      dirty,
      yamlText,
      yamlDirty,
      yamlMode,
      activeCategory,
    };
  });

  // Preserve unsaved work across route/profile switches: the plain
  // BrowserRouter has no data-router blocker, so this scoped per-profile
  // session draft is the honest fallback. A clean page clears any stale
  // draft instead of restoring it.
  useEffect(() => {
    return () => {
      const state = draftStateRef.current;
      if (!state.config) return;
      if (state.dirty || state.yamlDirty) {
        writeConfigDraft(draftKey, {
          config: state.config,
          yamlMode: state.yamlMode,
          yamlText: state.yamlText,
          activeCategory: state.activeCategory,
        });
      } else {
        clearConfigDraft(draftKey);
      }
    };
  }, [draftKey]);

  // Reload/close must not lose typed values either.
  useEffect(() => {
    if (!dirty && !yamlDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, yamlDirty]);

  useLayoutEffect(() => {
    if (!config || !schema) {
      setEnd(null);
      return;
    }
    setEnd(
      <SearchInput
        className="w-full sm:max-w-xs"
        inputClassName="h-8 text-xs"
        placeholder={t.common.search}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        onClear={() => setSearchQuery("")}
        clearLabel={t.common.clear}
        aria-label={t.config.searchFields ?? en.config.searchFields}
      />,
    );
    return () => setEnd(null);
  }, [config, schema, searchQuery, setEnd, t.common.clear, t.common.search, t.config.searchFields]);

  function prettyCategoryName(cat: string): string {
    const key = cat as keyof typeof t.config.categories;
    if (t.config.categories[key]) return t.config.categories[key];
    return cat.charAt(0).toUpperCase() + cat.slice(1);
  }

  useEffect(() => {
    api
      .getConfig()
      .then((cfg) => {
        // A draft preserved by an earlier visit wins over the server copy,
        // but the server copy stays the saved baseline so dirty/Save/reset
        // semantics are unchanged.
        const draft = readConfigDraft(draftKey);
        if (draft) {
          setConfig(draft.config);
          setActiveCategory(draft.activeCategory);
          if (draft.yamlMode) {
            skipYamlLoadRef.current = true;
            setYamlMode(true);
            setYamlText(draft.yamlText);
            setYamlDirty(true);
          }
          clearConfigDraft(draftKey);
          setDraftRestored(true);
        } else {
          setConfig(cfg);
        }
        setSavedJson(JSON.stringify(cfg));
      })
      .catch(() => {});
    api
      .getSchema()
      .then((resp) => {
        // memory.provider has a dedicated management UI on the Plugins page
        // (provider cards + guided setup/switch flow). Hide it from the
        // generic config form so the two surfaces don't fight; the schema
        // keeps the field for other consumers (Desktop settings).
        const fields = { ...resp.fields } as Record<
          string,
          Record<string, unknown>
        >;
        delete fields["memory.provider"];
        setSchema(fields);
        setCategoryOrder(resp.category_order ?? []);
      })
      .catch(() => {});
    api
      .getDefaults()
      .then(setDefaults)
      .catch(() => {});
    // getConfigRaw is profile-scoped (fetchJSON appends ?profile=), so its
    // `path` reflects the switched profile's config.yaml. /api/status's
    // config_path is machine-global (the dashboard's own profile) — wrong
    // header under the global profile switcher, so it's only a fallback.
    api
      .getConfigRaw()
      .then((resp) => {
        if (resp.path) setConfigPath(resp.path);
      })
      .catch(() => {});
    api
      .getStatus()
      .then((resp) => setConfigPath((prev) => prev ?? resp.config_path))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-scoped; profile changes remount this page through ProfileKeyedRoutes.
  }, []);

  // Set active category when categories load
  useEffect(() => {
    if (categoryOrder.length > 0 && !activeCategory) {
      setActiveCategory(categoryOrder[0]);
    }
  }, [categoryOrder, activeCategory]);

  // Load YAML when switching to YAML mode
  useEffect(() => {
    if (!yamlMode) return;
    if (skipYamlLoadRef.current) {
      skipYamlLoadRef.current = false;
      return;
    }
    setYamlLoading(true);
    api
      .getConfigRaw()
      .then((resp) => {
        setYamlText(resp.yaml);
        setYamlDirty(false);
      })
      .catch(() => showToast(t.config.failedToLoadRaw, "error"))
      .finally(() => setYamlLoading(false));
  }, [yamlMode, showToast, t.config.failedToLoadRaw]);

  /* ---- Categories ---- */
  const categories = useMemo(() => {
    if (!schema) return [];
    const allCats = [
      ...new Set(
        Object.values(schema).map((s) => String(s.category ?? "general")),
      ),
    ];
    const ordered = categoryOrder.filter((c) => allCats.includes(c));
    const extra = allCats.filter((c) => !categoryOrder.includes(c)).sort();
    return [...ordered, ...extra];
  }, [schema, categoryOrder]);

  /* ---- Category field counts ---- */
  const categoryCounts = useMemo(() => {
    if (!schema) return {};
    const counts: Record<string, number> = {};
    for (const s of Object.values(schema)) {
      const cat = String(s.category ?? "general");
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [schema]);

  /* ---- Search ---- */
  const isSearching = searchQuery.trim().length > 0;
  const lowerSearch = searchQuery.toLowerCase();

  const searchMatchedFields = useMemo(() => {
    if (!isSearching || !schema) return [];
    return Object.entries(schema).filter(([key, s]) => {
      const label = key.split(".").pop() ?? key;
      const humanLabel = label.replace(/_/g, " ");
      return (
        key.toLowerCase().includes(lowerSearch) ||
        humanLabel.toLowerCase().includes(lowerSearch) ||
        String(s.category ?? "")
          .toLowerCase()
          .includes(lowerSearch) ||
        String(s.description ?? "")
          .toLowerCase()
          .includes(lowerSearch)
      );
    });
  }, [isSearching, lowerSearch, schema]);

  /* ---- Active tab fields ---- */
  const activeFields = useMemo(() => {
    if (!schema || isSearching) return [];
    return Object.entries(schema).filter(
      ([, s]) => String(s.category ?? "general") === activeCategory,
    );
  }, [schema, activeCategory, isSearching]);

  /* ---- Handlers ---- */
  const handleSave = async () => {
    if (!config) return;
    // Capture the exact snapshot submitted. Edits made while the request is
    // in flight must stay dirty; they are not part of this save.
    const submitted = config;
    setSaving(true);
    setSaveError(null);
    try {
      await api.saveConfig(submitted);
      setSavedJson(JSON.stringify(submitted));
      clearConfigDraft(draftKey);
      setDraftRestored(false);
      showToast(t.config.configSaved, "success");
    } catch (e) {
      const detail = errorMessage(e);
      setSaveError(`${t.config.failedToSave}: ${detail}`);
      showToast(`${t.config.failedToSave}: ${detail}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (!savedJson) return;
    setConfig(JSON.parse(savedJson) as Record<string, unknown>);
    setSaveError(null);
    clearConfigDraft(draftKey);
    setDraftRestored(false);
  };

  const handleYamlSave = async () => {
    setYamlSaving(true);
    try {
      await api.saveConfigRaw(yamlText);
      showToast(t.config.yamlConfigSaved, "success");
      setYamlDirty(false);
      clearConfigDraft(draftKey);
      setDraftRestored(false);
      api
        .getConfig()
        .then((cfg) => {
          setConfig(cfg);
          setSavedJson(JSON.stringify(cfg));
        })
        .catch(() => {});
    } catch (e) {
      showToast(`${t.config.failedToSaveYaml}: ${errorMessage(e)}`, "error");
    } finally {
      setYamlSaving(false);
    }
  };

  const requestYamlSwitch = () => {
    // Neither direction may drop typed text without an explicit choice.
    if (!yamlMode && dirty) {
      setConfirmYamlSwitch(true);
      return;
    }
    if (yamlMode && yamlDirty) {
      setConfirmYamlDiscard(true);
      return;
    }
    setYamlMode(!yamlMode);
  };

  const handleReset = () => {
    if (!defaults || !config) return;
    // Scope the reset to what the user is currently looking at:
    //   - search mode → the matched fields
    //   - form mode   → the active category's fields
    // Resetting the whole config here was a footgun (issue reported by @ykmfb001):
    // the button sits next to the category tabs and users reasonably assumed
    // "reset this tab", not "wipe my entire config.yaml".
    const scopedFields = isSearching ? searchMatchedFields : activeFields;
    if (scopedFields.length === 0) return;
    setConfirmReset(true);
  };

  const executeReset = () => {
    if (!defaults || !config) return;
    setConfirmReset(false);
    const scopedFields = isSearching ? searchMatchedFields : activeFields;
    if (scopedFields.length === 0) return;
    const scopeLabel = isSearching
      ? t.config.searchResults
      : prettyCategoryName(activeCategory);
    // Pure: the form state changes, config.yaml is untouched until Save.
    setConfig(
      applyScopedReset(
        config,
        defaults,
        scopedFields.map(([key]) => key),
      ),
    );
    showToast(
      t.config.resetScopeToast.replace("{scope}", scopeLabel),
      "success",
    );
  };

  const handleExport = () => {
    if (!config) return;
    const blob = new Blob([JSON.stringify(config, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hermes-config.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result as string);
        setConfig(imported);
        showToast(t.config.configImported, "success");
      } catch {
        showToast(t.config.invalidJson, "error");
      }
    };
    reader.readAsText(file);
  };

  /* ---- Loading ---- */
  if (!config || !schema) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
          <span>{t.common.loading}</span>
        </div>
      </div>
    );
  }

  /* ---- Render field groups (shared between search & normal) ---- */
  const renderFieldGroups = (
    fields: [string, Record<string, unknown>][],
    showCategory = false,
  ): ReactNode => {
    const groups = new Map<
      string,
      { title: ReactNode; items: [string, Record<string, unknown>][] }
    >();
    for (const entry of fields) {
      const [key, s] = entry;
      const cat = String(s.category ?? "general");
      const section = key.includes(".") ? key.split(".")[0] : "";
      const groupKey = showCategory ? cat : section || "__root__";
      let group = groups.get(groupKey);
      if (!group) {
        group = {
          title: showCategory ? (
            <span className="flex items-center gap-2">
              <CategoryIcon category={cat} className="h-4 w-4" />
              {prettyCategoryName(cat)}
            </span>
          ) : groupKey === "__root__" ? (
            t.common.general
          ) : (
            humanizeSection(section)
          ),
          items: [],
        };
        groups.set(groupKey, group);
      }
      group.items.push(entry);
    }

    return (
      <div className="flex flex-col gap-6">
        {[...groups.entries()].map(([groupKey, group]) => (
          <SettingsSection
            key={groupKey}
            title={group.title}
            actions={
              <Badge>
                {group.items.length}{" "}
                {t.config.fields.replace(
                  "{s}",
                  group.items.length !== 1 ? "s" : "",
                )}
              </Badge>
            }
          >
            <SettingsGroup>
              {group.items.map(([key, s]) => (
                <AutoField
                  key={key}
                  schemaKey={key}
                  schema={s}
                  value={getNestedValue(config, key)}
                  onChange={(v) => setConfig(setNestedValue(config, key, v))}
                />
              ))}
            </SettingsGroup>
          </SettingsSection>
        ))}
      </div>
    );
  };

  const resetScopeLabel = isSearching
    ? t.config.searchResults
    : prettyCategoryName(activeCategory);
  const resetTitle = t.config.resetScopeTooltip.replace(
    "{scope}",
    resetScopeLabel,
  );

  return (
    <div className="flex flex-col gap-4">
      <PluginSlot name="config:top" />
      <Toast toast={toast} />

      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-center gap-2 sm:flex-1">
          <Settings2 className="h-4 w-4 shrink-0 text-text-tertiary" />
          <code className="min-w-0 flex-1 truncate text-xs text-text-tertiary">
            {configPath ?? t.config.configPath}
          </code>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleExport}
            title={t.config.exportConfig}
            aria-label={t.config.exportConfig}
          >
            <Download />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={saving || yamlSaving}
            title={t.config.importConfig}
            aria-label={t.config.importConfig}
          >
            <Upload />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImport}
          />
          {!yamlMode && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleReset}
              title={resetTitle}
              aria-label={resetTitle}
            >
              <RotateCcw />
            </Button>
          )}

          <div className="mx-1 h-5 w-px bg-border" />

          <Button
            variant={yamlMode ? "ghost" : "secondary"}
            size="sm"
            onClick={requestYamlSwitch}
            disabled={saving || yamlSaving}
            icon={yamlMode ? <FormInput /> : <Code />}
          >
            {yamlMode ? t.common.form : "YAML"}
          </Button>

          {yamlMode && (
            <Button
              variant="primary"
              size="sm"
              loading={yamlSaving}
              disabled={!yamlDirty}
              onClick={handleYamlSave}
            >
              {yamlSaving ? t.common.saving : t.common.save}
            </Button>
          )}
        </div>
      </div>

      {yamlMode ? (
        <div className="ui-surface overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <FileText className="h-4 w-4 text-text-tertiary" />
            <h2 className="ui-section-heading">{t.config.rawYaml}</h2>
            {yamlDirty && (
              <StatusText tone="warning" className="ml-auto">
                {t.config.unsavedChanges ?? en.config.unsavedChanges}
              </StatusText>
            )}
          </div>
          {yamlLoading ? (
            <div className="flex items-center justify-center py-12 text-sm text-text-tertiary">
              {t.common.loading}
            </div>
          ) : (
            <textarea
              className="ui-textarea ui-textarea--mono min-h-[600px] w-full rounded-none border-0 bg-transparent focus-visible:shadow-none"
              value={yamlText}
              disabled={yamlSaving}
              onChange={(e) => {
                setYamlText(e.target.value);
                setYamlDirty(true);
              }}
              spellCheck={false}
              aria-label={t.config.rawYaml}
            />
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row">
          <aside aria-label={t.config.filters} className="sm:w-60 sm:shrink-0">
            <div className="sm:hidden">
              <label htmlFor="config-mobile-category" className="ui-field__label mb-2 block">
                {t.config.filters}
              </label>
              <Select
                id="config-mobile-category"
                value={isSearching ? "" : activeCategory}
                onChange={(event) => {
                  setSearchQuery("");
                  setActiveCategory(event.target.value);
                }}
              >
                {isSearching && <option value="" disabled>{t.config.searchResults}</option>}
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {prettyCategoryName(cat)} ({categoryCounts[cat] || 0})
                  </option>
                ))}
              </Select>
            </div>
            <div className="hidden sm:sticky sm:top-4 sm:block">
              <div className="ui-settings-group p-2">
                <div className="flex items-center gap-2 px-2 pb-1.5 pt-1 text-xs font-medium text-text-tertiary">
                  <Filter className="h-3.5 w-3.5" aria-hidden />
                  <span>{t.config.filters}</span>
                </div>

                <ul className="ui-nav max-h-[calc(100vh-300px)] overflow-y-auto">
                  {categories.map((cat) => {
                    const isActive = !isSearching && activeCategory === cat;

                    return (
                      <li key={cat}>
                        <button
                          type="button"
                          aria-current={isActive ? "true" : undefined}
                          onClick={() => {
                            setSearchQuery("");
                            setActiveCategory(cat);
                          }}
                          className={cn(
                            "ui-nav__item",
                            isActive && "ui-nav__item--active",
                          )}
                        >
                          <CategoryIcon
                            category={cat}
                            className="ui-nav__item-icon"
                          />
                          <span className="ui-nav__item-label">
                            {prettyCategoryName(cat)}
                          </span>
                          <span className="ui-nav__count">
                            {categoryCounts[cat] || 0}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </aside>

          <div className="min-w-0 flex-1">
            {isSearching ? (
              searchMatchedFields.length === 0 ? (
                <div className="ui-surface">
                  <NoMatchState
                    title={t.common.noResults}
                    description={t.config.noFieldsMatch.replace(
                      "{query}",
                      searchQuery,
                    )}
                    action={
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setSearchQuery("")}
                      >
                        {t.common.clear}
                      </Button>
                    }
                  />
                </div>
              ) : (
                renderFieldGroups(searchMatchedFields, true)
              )
            ) : activeFields.length === 0 ? (
              <div className="ui-surface">
                <EmptyState
                  title={t.common.none}
                  description={prettyCategoryName(activeCategory)}
                />
              </div>
            ) : (
              renderFieldGroups(activeFields)
            )}
          </div>
        </div>
      )}

      {dirty && !yamlMode && (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-popover/95 px-4 py-3 shadow-lg backdrop-blur">
          <StatusText tone="warning">
            {t.config.unsavedChanges ?? en.config.unsavedChanges}
          </StatusText>
          {draftRestored && (
            <StatusText tone="muted" className="text-xs">
              {t.config.draftRestored ?? en.config.draftRestored}
            </StatusText>
          )}
          {saveError && (
            <span
              className="min-w-0 flex-1 basis-full text-xs leading-relaxed text-destructive sm:basis-auto"
              role="alert"
            >
              {saveError}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDiscard}
              disabled={saving}
            >
              {t.config.discard ?? en.config.discard}
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={saving}
              onClick={handleSave}
            >
              {saving ? t.common.saving : t.common.save}
            </Button>
          </div>
        </div>
      )}

      <PluginSlot name="config:bottom" />

      <ConfirmDialog
        open={confirmReset}
        onCancel={() => setConfirmReset(false)}
        onConfirm={executeReset}
        title={t.config.confirmResetScope.replace("{scope}", resetScopeLabel)}
        description={`This will reset ${
          (isSearching ? searchMatchedFields : activeFields).length
        } field(s) to their default values.`}
        confirmLabel={t.config.resetDefaults}
        cancelLabel={t.common.cancel}
      />

      <ConfirmDialog
        open={confirmYamlSwitch}
        onCancel={() => setConfirmYamlSwitch(false)}
        onConfirm={() => {
          setConfirmYamlSwitch(false);
          setYamlMode(true);
        }}
        title={t.config.confirmYamlSwitch ?? en.config.confirmYamlSwitch!}
        description={
          t.config.confirmYamlSwitchDesc ?? en.config.confirmYamlSwitchDesc!
        }
        confirmLabel={t.common.confirm}
        cancelLabel={t.common.cancel}
        destructive={false}
      />

      <ConfirmDialog
        open={confirmYamlDiscard}
        onCancel={() => setConfirmYamlDiscard(false)}
        onConfirm={() => {
          setConfirmYamlDiscard(false);
          setYamlDirty(false);
          setYamlMode(false);
        }}
        title={t.config.confirmYamlDiscard ?? en.config.confirmYamlDiscard!}
        description={
          t.config.confirmYamlDiscardDesc ?? en.config.confirmYamlDiscardDesc!
        }
        confirmLabel={t.common.discard ?? en.common.discard!}
        cancelLabel={t.common.keepEditing ?? en.common.keepEditing!}
      />
    </div>
  );
}
