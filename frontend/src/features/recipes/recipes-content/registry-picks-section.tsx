"use client";

import { useCallback, useState } from "react";
import { DownloadCloud, RefreshCw } from "@/ui/icon-registry";
import { ModelLogo } from "@/ui/model-logo";
import { ResourceDrawer, ResourceDrawerSection, ResourceFact } from "@/ui/resource-drawer";
import { ModelButton, StatusPill } from "@/ui";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { useRealtimeStatusStore } from "@/hooks/realtime-status-store";
import { safeJson } from "@/features/agent/safe-json";
import { useDownloads } from "@/hooks/use-downloads";
import { cx } from "@/ui/utils";
import {
  DataRow,
  EndCell,
  GroupRow,
  HeadCell,
  LeadCell,
  NumCell,
  RowAction,
  StatusText,
  TableFrame,
} from "./catalog-table-shell";
import { useHardwareProfile } from "./picks-shared";
import { downloadProgressText } from "./downloads-tab";

interface RegistryModelVariant {
  recipeId: string;
  quant: string;
  precision: string | null;
  format: string | null;
  filesizeGb: number;
  filesize: string;
  requiredGb: number;
  status: "validated" | "candidate";
  engine: string | null;
  engineVersion: string | null;
  architecture: string | null;
  measuredOnThisClass: boolean;
}

interface RegistryModel {
  hfId: string;
  name: string;
  owner: string;
  variants: RegistryModelVariant[];
  bestVariant: RegistryModelVariant;
  params: string | null;
  activeParams: string | null;
  contextTokens: number | null;
  architecture: string | null;
  capabilities: {
    chat: boolean;
    reasoning: boolean;
    tools: boolean;
    vision: boolean;
  };
  engines: string[];
  measuredOnThisClass: boolean;
}

interface RegistryModelsMeta {
  readonly updated: string | null;
  readonly models: readonly RegistryModel[];
}

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  readonly result: RegistryModelsMeta;
  readonly expiresAt: number;
}

const registryModelsCache = new Map<string, CacheEntry>();

const readCache = (key: string): RegistryModelsMeta | null => {
  const entry = registryModelsCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    registryModelsCache.delete(key);
    return null;
  }
  return entry.result;
};

const writeCache = (key: string, result: RegistryModelsMeta): void => {
  registryModelsCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
};

const formatContext = (tokens: number | null): string => {
  if (tokens == null) return "—";
  if (tokens >= 1024) return `${(tokens / 1024).toFixed(0)}K`;
  return tokens.toLocaleString();
};

const formatParams = (params: string | null, active: string | null): string => {
  if (!params) return "—";
  if (active && active !== params) return `${active}A / ${params}B`;
  return `${params}B`;
};

const describeHardware = (hardware: {
  gpuCount: number;
  names: readonly string[];
  appleSilicon: boolean;
}): string => {
  if (hardware.appleSilicon) return hardware.names[0] ?? "Apple Silicon";
  if (hardware.names.length === 0) return "Unknown hardware";
  const unique = Array.from(new Set(hardware.names));
  const count = hardware.gpuCount;
  if (unique.length === 1) {
    return count > 1 ? `${count}× ${unique[0]}` : unique[0];
  }
  return count > 1 ? `${count} GPUs (${unique.join(" + ")})` : unique.join(" + ");
};

const sizeRangeLabel = (variants: readonly RegistryModelVariant[]): string => {
  if (variants.length === 0) return "—";
  const sizes = variants.map((v) => v.filesizeGb);
  const min = Math.min(...sizes);
  const max = Math.max(...sizes);
  const format = (n: number) => `${Math.round(n * 10) / 10}gb`;
  return min === max ? format(min) : `${format(min)}–${format(max)}`;
};

const groupModelsByEngine = (
  models: readonly RegistryModel[],
): Array<{ engine: string; models: RegistryModel[] }> => {
  const order: string[] = [];
  const byEngine = new Map<string, RegistryModel[]>();
  for (const model of models) {
    const engine = model.engines[0] ?? "unknown";
    if (!byEngine.has(engine)) {
      byEngine.set(engine, []);
      order.push(engine);
    }
    byEngine.get(engine)!.push(model);
  }
  return order.map((engine) => ({ engine, models: byEngine.get(engine)! }));
};

export function RegistryPicksSection() {
  const hardware = useHardwareProfile();
  const realtimeSnapshot = useRealtimeStatusStore();
  const realtimeGpus = realtimeSnapshot.gpus;
  const { downloadsByModel, startingModelIds, startDownload } = useDownloads();
  const [meta, setMeta] = useState<RegistryModelsMeta>({ updated: null, models: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<RegistryModel | null>(null);

  const refresh = useCallback(
    async (force = false) => {
      if (hardware.poolGb <= 0) {
        setLoading(false);
        return;
      }
      const gpuName = realtimeGpus[0]?.name ?? "";
      const params = new URLSearchParams({
        poolGb: String(Math.round(hardware.poolGb)),
      });
      if (gpuName) params.set("gpuName", gpuName);
      const url = `/api/setup/registry-models?${params}`;

      if (!force) {
        const cached = readCache(url);
        if (cached) {
          setMeta(cached);
          setError(null);
          setLoading(false);
          return;
        }
      }

      setLoading(true);
      setError(null);
      try {
        const response = await fetch(url, { cache: "no-store" });
        const payload = await safeJson<RegistryModelsMeta>(response);
        const result: RegistryModelsMeta = {
          updated: payload.updated ?? null,
          models: payload.models ?? [],
        };
        setMeta(result);
        writeCache(url, result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load registry models");
      } finally {
        setLoading(false);
      }
    },
    [hardware.poolGb, realtimeGpus],
  );

  useMountSubscription(() => {
    void refresh();
  }, [refresh]);

  const handleDownload = useCallback(
    (hfId: string) => {
      void startDownload({ model_id: hfId }).catch(() => {});
    },
    [startDownload],
  );

  const validatedCount = meta.models.filter((model) =>
    model.variants.some((v) => v.status === "validated"),
  ).length;
  const totalVariants = meta.models.reduce((sum, model) => sum + model.variants.length, 0);

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-(--ui-separator) pb-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-[length:var(--fs-md)] text-(--ui-fg)" title={hardware.detail}>
            {hardware.poolGb > 0
              ? `${describeHardware(hardware)} · ${Math.round(hardware.poolGb)} GB pool`
              : "No GPUs detected"}
          </span>
          <span className="truncate text-[length:var(--fs-sm)] text-(--ui-muted)">
            {hardware.poolGb > 0
              ? `models that fit your ${Math.round(hardware.poolGb)} GB pool`
              : "Connect the controller to check hardware fit."}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {meta.updated ? (
            <span className="text-[length:var(--fs-xs)] text-(--ui-muted)/70">
              updated {meta.updated}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void refresh(true)}
            disabled={loading}
            title="Reload from registry"
            aria-label="Reload from registry"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-(--ui-muted) transition-colors hover:bg-(--ui-hover) hover:text-(--ui-fg) disabled:opacity-45"
          >
            <RefreshCw className={cx("h-3.5 w-3.5", loading ? "animate-spin" : "")} />
          </button>
        </div>
      </div>

      {error ? <div className="text-[length:var(--fs-sm)] text-(--err)">{error}</div> : null}

      {!loading && meta.models.length === 0 ? (
        <div className="text-[length:var(--fs-sm)] text-(--ui-muted)">
          No registry models matched your hardware. Try the Recommended tab for the curated catalog.
        </div>
      ) : (
        <TableFrame>
          <thead>
            <tr>
              <HeadCell>Model</HeadCell>
              <HeadCell numeric title="Engines the registry has recipes for on this hardware">
                Engines
              </HeadCell>
              <HeadCell numeric title="No intelligence index is published for registry models">
                Index
              </HeadCell>
              <HeadCell numeric>Params</HeadCell>
              <HeadCell numeric>Context</HeadCell>
              <HeadCell numeric title="Size range across the model's variants">
                Memory
              </HeadCell>
              <HeadCell numeric>Status</HeadCell>
            </tr>
          </thead>
          {groupModelsByEngine(meta.models).map((group) => {
            const validatedCount = group.models.filter((model) =>
              model.variants.some((v) => v.status === "validated"),
            ).length;
            return (
              <tbody key={group.engine}>
                <GroupRow
                  colSpan={7}
                  label={`${group.engine} recipes`}
                  blurb={`${group.models.length} models`}
                  right={validatedCount > 0 ? `${validatedCount} validated` : "candidate only"}
                />
                {group.models.map((model) => (
                  <DataRow
                    key={model.hfId}
                    onOpen={() => setSelectedModel(model)}
                    ariaLabel={`Open ${model.name} variants`}
                  >
                    <LeadCell>
                      <div className="flex min-w-0 items-center gap-2.5">
                        <ModelLogo
                          modelId={model.hfId}
                          author={model.owner}
                          label={model.name}
                          size="sm"
                          className="rounded-md"
                        />
                        <span className="min-w-0 truncate text-[length:var(--fs-md)] font-medium text-(--fg)">
                          {model.name}
                        </span>
                        <span className="shrink-0 text-[length:var(--fs-sm)] text-(--dim)/70">
                          {model.owner}
                        </span>
                        <span className="shrink-0 rounded border border-(--ui-border) px-1.5 py-px font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
                          {model.variants.length} var
                        </span>
                      </div>
                    </LeadCell>

                    <NumCell>{model.engines.join(", ") || "—"}</NumCell>

                    <NumCell>
                      <span className="text-[length:var(--fs-sm)] text-(--dim)/50">not rated</span>
                    </NumCell>

                    <NumCell>{formatParams(model.params, model.activeParams)}</NumCell>

                    <NumCell>{formatContext(model.contextTokens)}</NumCell>

                    <NumCell>{sizeRangeLabel(model.variants)}</NumCell>

                    <EndCell>
                      <ModelActions
                        hfId={model.hfId}
                        isStarting={startingModelIds.has(model.hfId)}
                        download={downloadsByModel.get(model.hfId) ?? null}
                        onDownload={() => handleDownload(model.hfId)}
                      />
                    </EndCell>
                  </DataRow>
                ))}
              </tbody>
            );
          })}
        </TableFrame>
      )}

      <p className="text-[length:var(--fs-xs)] text-(--dim)/70">
        {meta.models.length > 0
          ? `Index — registry. ${validatedCount} of ${meta.models.length} models have at least one validated variant. ${totalVariants} variants total. Refresh above to re-query.`
          : "Index — registry. Refresh above to re-query."}
      </p>

      {selectedModel ? (
        <RegistryModelDrawer
          model={selectedModel}
          downloadsByModel={downloadsByModel}
          startingModelIds={startingModelIds}
          onClose={() => setSelectedModel(null)}
          onDownload={(hfId) => handleDownload(hfId)}
        />
      ) : null}
    </div>
  );
}

function ModelActions({
  hfId,
  isStarting,
  download,
  onDownload,
}: {
  hfId: string;
  isStarting: boolean;
  download: { status: string } | null;
  onDownload: () => void;
}) {
  if (isStarting) return <StatusText>starting…</StatusText>;
  if (download?.status === "downloading" || download?.status === "paused") {
    return <StatusText>{downloadProgressText(download as never)}</StatusText>;
  }
  if (download?.status === "completed") return <StatusText>on disk</StatusText>;
  if (download?.status === "failed") return <StatusText tone="error">failed</StatusText>;
  return (
    <RowAction onClick={onDownload}>
      <DownloadCloud className="h-3 w-3" />
      Download
    </RowAction>
  );
}

function RegistryModelDrawer({
  model,
  downloadsByModel,
  startingModelIds,
  onClose,
  onDownload,
}: {
  model: RegistryModel;
  downloadsByModel: Map<string, { status: string }>;
  startingModelIds: Set<string>;
  onClose: () => void;
  onDownload: (hfId: string) => void;
}) {
  const validatedCount = model.variants.filter((v) => v.status === "validated").length;
  return (
    <ResourceDrawer
      title={model.name}
      icon={<ModelLogo modelId={model.hfId} author={model.owner} label={model.name} size="sm" />}
      badge={
        <div className="flex items-center gap-1.5">
          {model.engines.map((engine) => (
            <StatusPill key={engine} tone="default">
              {engine}
            </StatusPill>
          ))}
          {validatedCount > 0 ? (
            <StatusPill tone="good">{validatedCount} validated</StatusPill>
          ) : (
            <StatusPill tone="info">candidate</StatusPill>
          )}
        </div>
      }
      status={`${model.owner} · ${formatParams(model.params, model.activeParams)}`}
      footer={
        <>
          <ModelButton onClick={onClose}>Done</ModelButton>
        </>
      }
      onClose={onClose}
    >
      <ResourceDrawerSection
        title={`Variants (${model.variants.length})`}
        description="Pick the build that fits your rig and start the download."
      >
        {model.variants.map((variant) => (
          <VariantRow
            key={variant.recipeId}
            variant={variant}
            isStarting={startingModelIds.has(model.hfId)}
            download={downloadsByModel.get(model.hfId) ?? null}
            onDownload={() => onDownload(model.hfId)}
          />
        ))}
      </ResourceDrawerSection>

      <ResourceDrawerSection title="Model">
        <ResourceFact label="Repository" value={model.hfId} />
        {model.architecture ? (
          <ResourceFact label="Architecture" value={model.architecture} />
        ) : null}
        <ResourceFact label="Parameters" value={formatParams(model.params, model.activeParams)} />
        <ResourceFact
          label="Max context"
          value={`${model.contextTokens?.toLocaleString() ?? "—"} tokens`}
        />
        {model.capabilities.chat ? <ResourceFact label="Capabilities" value="chat" /> : null}
        {model.capabilities.vision ? <ResourceFact label="Vision" value="yes" /> : null}
        {model.capabilities.reasoning ? <ResourceFact label="Reasoning" value="yes" /> : null}
        {model.capabilities.tools ? <ResourceFact label="Tools" value="yes" /> : null}
      </ResourceDrawerSection>
    </ResourceDrawer>
  );
}

function VariantRow({
  variant,
  isStarting,
  download,
  onDownload,
}: {
  variant: RegistryModelVariant;
  isStarting: boolean;
  download: { status: string } | null;
  onDownload: () => void;
}) {
  const badge = (variant.precision ?? variant.format ?? variant.quant).toUpperCase();
  const busy = isStarting || download?.status === "downloading" || download?.status === "paused";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-(--ui-border)/40 py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-(--fg)">{badge}</span>
          <span className="font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
            {variant.filesize}
          </span>
          <span className="font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
            · needs ~{variant.requiredGb} GB
          </span>
          {variant.engine ? (
            <span className="font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
              · {variant.engine}
              {variant.engineVersion ? ` ${variant.engineVersion}` : ""}
            </span>
          ) : null}
          {variant.status === "validated" ? (
            <StatusPill tone="good">validated</StatusPill>
          ) : (
            <StatusPill tone="info">candidate</StatusPill>
          )}
        </div>
        <div className="mt-1 font-mono text-[length:var(--fs-xs)] text-(--ui-muted)/80">
          {variant.recipeId}
        </div>
      </div>
      <ModelButton tone="primary" disabled={busy} onClick={onDownload}>
        <DownloadCloud className={cx("h-3 w-3", busy ? "animate-pulse" : "")} />
        {busy ? "Working" : "Download"}
      </ModelButton>
    </div>
  );
}
