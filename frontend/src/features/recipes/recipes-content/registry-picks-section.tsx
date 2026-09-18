"use client";

import { useCallback, useState } from "react";
import { DownloadCloud, RefreshCw } from "@/ui/icon-registry";
import { ModelButton } from "@/ui";
import { ModelLogo } from "@/ui/model-logo";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { useRealtimeStatusStore } from "@/hooks/realtime-status-store";
import { safeJson } from "@/features/agent/safe-json";
import { useDownloads } from "@/hooks/use-downloads";
import { cx } from "@/ui/utils";
import type { SetupRecommendation } from "@/features/setup/recommendations";
import { useHardwareProfile } from "./picks-shared";

interface RegistryPicksMeta {
  readonly picks: readonly SetupRecommendation[];
  readonly updated: string | null;
}

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  readonly result: RegistryPicksMeta;
  readonly expiresAt: number;
}

const registryPicksCache = new Map<string, CacheEntry>();

const readCache = (key: string): RegistryPicksMeta | null => {
  const entry = registryPicksCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    registryPicksCache.delete(key);
    return null;
  }
  return entry.result;
};

const writeCache = (key: string, result: RegistryPicksMeta): void => {
  registryPicksCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
};

export function RegistryPicksSection() {
  const hardware = useHardwareProfile();
  const realtimeSnapshot = useRealtimeStatusStore();
  const realtimeGpus = realtimeSnapshot.gpus;
  const { downloadsByModel, startingModelIds, startDownload } = useDownloads();
  const [meta, setMeta] = useState<RegistryPicksMeta>({ picks: [], updated: null });
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
        gpuCount: String(hardware.gpuCount),
        unified: hardware.appleSilicon ? "1" : "0",
        apple: hardware.appleSilicon ? "1" : "0",
        limit: "6",
      });
      if (gpuName) params.set("gpuName", gpuName);
      const url = `/api/setup/recommendations?${params}`;

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
        const payload = await safeJson<{
          picks?: SetupRecommendation[];
          updated?: string;
        }>(response);
        const result: RegistryPicksMeta = {
          picks: payload.picks ?? [],
          updated: payload.updated ?? null,
        };
        setMeta(result);
        writeCache(url, result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load registry picks");
      } finally {
        setLoading(false);
      }
    },
    [hardware.appleSilicon, hardware.gpuCount, hardware.poolGb, realtimeGpus],
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
          {meta.picks.map((pick) => (
            <RegistryPickRow
              key={pick.hfId}
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

function RegistryPickRow({
  pick,
  isStarting,
  download,
  onDownload,
}: {
  pick: SetupRecommendation;
  isStarting: boolean;
  download: { status: string } | null;
  onDownload: (hfId: string) => void;
}) {
  const busy = isStarting || download?.status === "downloading" || download?.status === "paused";
  const quantBadge = pick.quant.toUpperCase();
  const owner = pick.hfId.split("/")[0]?.trim();
  return (
    <div className="group flex items-center gap-4 border-b border-(--ui-border)/60 px-4 py-3 transition-colors last:border-b-0 hover:bg-(--ui-hover)/40">
      <ModelLogo
        modelId={pick.hfId}
        author={owner}
        label={pick.name}
        size="sm"
        className="shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[length:var(--fs-md)] text-(--fg)">{pick.name}</span>
          <span className="shrink-0 rounded border border-(--ui-border) px-1.5 py-px font-mono text-[length:var(--fs-sm)] text-(--ui-muted)">
            {quantBadge}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-(--ui-muted)">
          <span>{pick.filesize}</span>
          <span>·</span>
          <span>needs ~{pick.requiredGb} GB</span>
          {pick.measuredOnThisClass ? (
            <>
              <span>·</span>
              <span className="text-(--ui-success)">measured on your class</span>
            </>
          ) : null}
        </div>
      </div>
      <ModelButton tone="primary" disabled={busy} onClick={() => onDownload(pick.hfId)}>
        <DownloadCloud className={cx("h-3 w-3", busy ? "animate-pulse" : "")} />
        {busy ? "Working" : "Download"}
      </ModelButton>
    </div>
  );
}
