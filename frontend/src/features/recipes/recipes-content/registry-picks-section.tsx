"use client";

import { useCallback, useState } from "react";
import {
  DownloadCloud,
  Eye,
  MessageSquare,
  RefreshCw,
  Sparkles,
  Wrench,
  Brain,
} from "@/ui/icon-registry";
import { ModelButton, StatusPill } from "@/ui";
import { ModelLogo } from "@/ui/model-logo";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { useRealtimeStatusStore } from "@/hooks/realtime-status-store";
import { safeJson } from "@/features/agent/safe-json";
import { useDownloads } from "@/hooks/use-downloads";
import { cx } from "@/ui/utils";
import { useHardwareProfile } from "./picks-shared";

interface RegistryRecipeRow {
  hfId: string;
  name: string;
  quant: string;
  filesizeGb: number;
  filesize: string;
  requiredGb: number;
  status: "validated" | "candidate";
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
  engine: string | null;
  engineVersion: string | null;
  hardwareId: string;
  hardwareLabel: string;
  measuredOnThisClass: boolean;
}

interface RegistryRecipesMeta {
  readonly updated: string | null;
  readonly picks: readonly RegistryRecipeRow[];
}

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  readonly result: RegistryRecipesMeta;
  readonly expiresAt: number;
}

const registryRecipesCache = new Map<string, CacheEntry>();

const readCache = (key: string): RegistryRecipesMeta | null => {
  const entry = registryRecipesCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    registryRecipesCache.delete(key);
    return null;
  }
  return entry.result;
};

const writeCache = (key: string, result: RegistryRecipesMeta): void => {
  registryRecipesCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
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

export function RegistryPicksSection() {
  const hardware = useHardwareProfile();
  const realtimeSnapshot = useRealtimeStatusStore();
  const realtimeGpus = realtimeSnapshot.gpus;
  const { downloadsByModel, startingModelIds, startDownload } = useDownloads();
  const [meta, setMeta] = useState<RegistryRecipesMeta>({ updated: null, picks: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      const url = `/api/setup/registry-recipes?${params}`;

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
        const payload = await safeJson<RegistryRecipesMeta>(response);
        const result: RegistryRecipesMeta = {
          updated: payload.updated ?? null,
          picks: payload.picks ?? [],
        };
        setMeta(result);
        writeCache(url, result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load registry recipes");
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

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-(--ui-separator) pb-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-[length:var(--fs-md)] text-(--ui-fg)" title={hardware.detail}>
            {hardware.poolGb > 0 ? `${Math.round(hardware.poolGb)} GB pool` : "No GPUs detected"}
          </span>
          <span className="truncate text-[length:var(--fs-sm)] text-(--ui-muted)">
            {hardware.poolGb > 0
              ? `${hardware.label} — recipes that fit your ${Math.round(hardware.poolGb)} GB pool`
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

      {!loading && meta.picks.length === 0 ? (
        <div className="text-[length:var(--fs-sm)] text-(--ui-muted)">
          No registry recipes matched your hardware. Try the Recommended tab for the curated
          catalog.
        </div>
      ) : (
        <div className="overflow-hidden rounded-[10px] border border-(--ui-border) bg-(--ui-surface)/25">
          <div className="grid grid-cols-[minmax(0,1.6fr)_auto_auto_auto_auto_auto_auto] items-center gap-3 border-b border-(--ui-border)/60 px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-(--ui-muted)/70">
            <span>Model</span>
            <span className="text-right">Status</span>
            <span className="text-right">Params</span>
            <span className="text-right">Context</span>
            <span className="text-right">Memory</span>
            <span className="text-right">Caps</span>
            <span></span>
          </div>
          {meta.picks.map((pick) => (
            <RegistryRecipeTableRow
              key={`${pick.hfId}/${pick.hardwareId}/${pick.engine ?? "?"}`}
              pick={pick}
              isStarting={startingModelIds.has(pick.hfId)}
              download={downloadsByModel.get(pick.hfId) ?? null}
              onDownload={handleDownload}
            />
          ))}
        </div>
      )}

      <p className="text-[length:var(--fs-xs)] text-(--dim)/70">
        Source — local-ai-registry. Refresh above to re-query.
      </p>
    </div>
  );
}

function RegistryRecipeTableRow({
  pick,
  isStarting,
  download,
  onDownload,
}: {
  pick: RegistryRecipeRow;
  isStarting: boolean;
  download: { status: string } | null;
  onDownload: (hfId: string) => void;
}) {
  const busy = isStarting || download?.status === "downloading" || download?.status === "paused";
  const quantBadge = pick.quant.toUpperCase();
  const owner = pick.hfId.split("/")[0]?.trim();
  return (
    <div className="group grid grid-cols-[minmax(0,1.6fr)_auto_auto_auto_auto_auto_auto] items-center gap-3 border-b border-(--ui-border)/60 px-4 py-3 transition-colors last:border-b-0 hover:bg-(--ui-hover)/40">
      <div className="flex min-w-0 items-center gap-3">
        <ModelLogo
          modelId={pick.hfId}
          author={owner}
          label={pick.name}
          size="sm"
          className="shrink-0"
        />
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[length:var(--fs-md)] text-(--fg)">{pick.name}</span>
            <span className="shrink-0 rounded border border-(--ui-border) px-1.5 py-px font-mono text-[length:var(--fs-sm)] text-(--ui-muted)">
              {quantBadge}
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-(--ui-muted)/80">
            {pick.hfId} · {pick.hardwareLabel}
          </div>
        </div>
      </div>
      <div className="text-right">
        <StatusPill tone={pick.status === "validated" ? "good" : "info"}>{pick.status}</StatusPill>
      </div>
      <div className="text-right font-mono text-[11px] text-(--ui-muted)">
        {formatParams(pick.params, pick.activeParams)}
      </div>
      <div className="text-right font-mono text-[11px] text-(--ui-muted)">
        {formatContext(pick.contextTokens)}
      </div>
      <div className="text-right font-mono text-[11px] text-(--ui-muted)">{pick.filesize}</div>
      <div className="flex justify-end gap-1">
        {pick.capabilities.chat ? (
          <span title="chat" className="text-(--ui-muted)">
            <MessageSquare className="h-3.5 w-3.5" />
          </span>
        ) : null}
        {pick.capabilities.vision ? (
          <span title="vision" className="text-(--ui-muted)">
            <Eye className="h-3.5 w-3.5" />
          </span>
        ) : null}
        {pick.capabilities.reasoning ? (
          <span title="reasoning" className="text-(--ui-muted)">
            <Brain className="h-3.5 w-3.5" />
          </span>
        ) : null}
        {pick.capabilities.tools ? (
          <span title="tools" className="text-(--ui-muted)">
            <Wrench className="h-3.5 w-3.5" />
          </span>
        ) : null}
        {!pick.capabilities.chat &&
        !pick.capabilities.vision &&
        !pick.capabilities.reasoning &&
        !pick.capabilities.tools ? (
          <span className="text-(--ui-muted)/40">—</span>
        ) : null}
      </div>
      <div className="flex justify-end">
        <ModelButton tone="primary" disabled={busy} onClick={() => onDownload(pick.hfId)}>
          <DownloadCloud className={cx("h-3 w-3", busy ? "animate-pulse" : "")} />
          {busy ? "Working" : "Download"}
        </ModelButton>
      </div>
    </div>
  );
}
