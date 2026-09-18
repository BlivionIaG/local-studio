"use client";

import { useCallback, useState } from "react";
import { DownloadCloud, RefreshCw } from "@/ui/icon-registry";
import { ModelLogo } from "@/ui/model-logo";
import { StatusPill } from "@/ui";
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

interface RegistryRecipeRow {
  recipeId: string;
  hfId: string;
  name: string;
  quant: string;
  precision: string | null;
  format: string | null;
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

const groupByEngine = (
  picks: readonly RegistryRecipeRow[],
): Array<{ engine: string; rows: RegistryRecipeRow[] }> => {
  const order: string[] = [];
  const byEngine = new Map<string, RegistryRecipeRow[]>();
  for (const pick of picks) {
    const engine = pick.engine ?? "unknown";
    if (!byEngine.has(engine)) {
      byEngine.set(engine, []);
      order.push(engine);
    }
    byEngine.get(engine)!.push(pick);
  }
  return order.map((engine) => ({ engine, rows: byEngine.get(engine)! }));
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

  const groups = groupByEngine(meta.picks);
  const validatedCount = meta.picks.filter((pick) => pick.status === "validated").length;
  const runnableCount = meta.picks.filter((pick) => pick.requiredGb <= hardware.poolGb).length;

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
              ? `recipes that fit your ${Math.round(hardware.poolGb)} GB pool`
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
        <TableFrame>
          <thead>
            <tr>
              <HeadCell>Model</HeadCell>
              <HeadCell numeric title="No intelligence index is published for registry recipes">
                Index
              </HeadCell>
              <HeadCell numeric>Params</HeadCell>
              <HeadCell numeric>Context</HeadCell>
              <HeadCell numeric title="Memory the weights need; 1.5x is the runnable headroom">
                Memory
              </HeadCell>
              <HeadCell numeric>Status</HeadCell>
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group.engine}>
              <GroupRow
                colSpan={6}
                label={`${group.engine} recipes`}
                blurb={
                  hardware.poolGb > 0
                    ? `${group.rows.filter((row) => row.requiredGb <= hardware.poolGb).length} of ${group.rows.length} run on this rig`
                    : `${group.rows.length} recipes`
                }
                right={
                  group.rows.filter((row) => row.status === "validated").length > 0
                    ? `${group.rows.filter((row) => row.status === "validated").length} validated`
                    : "candidate only"
                }
              />
              {group.rows.map((pick) => (
                <RegistryTableRow
                  key={pick.recipeId}
                  pick={pick}
                  poolGb={hardware.poolGb}
                  isStarting={startingModelIds.has(pick.hfId)}
                  download={downloadsByModel.get(pick.hfId) ?? null}
                  onDownload={handleDownload}
                />
              ))}
            </tbody>
          ))}
        </TableFrame>
      )}

      <p className="text-[length:var(--fs-xs)] text-(--dim)/70">
        {meta.picks.length > 0
          ? `Index — registry. ${validatedCount} validated, ${runnableCount} of ${meta.picks.length} fit in ${Math.round(hardware.poolGb)} GB. Refresh above to re-query.`
          : "Index — registry. Refresh above to re-query."}
      </p>
    </div>
  );
}

function RegistryTableRow({
  pick,
  poolGb,
  isStarting,
  download,
  onDownload,
}: {
  pick: RegistryRecipeRow;
  poolGb: number;
  isStarting: boolean;
  download: { status: string } | null;
  onDownload: (hfId: string) => void;
}) {
  const owner = pick.hfId.split("/")[0]?.trim();
  const overPool = poolGb > 0 && pick.requiredGb > poolGb;
  const badge = pick.precision ?? pick.format ?? pick.quant.toUpperCase();
  return (
    <DataRow dimmed={overPool} ariaLabel={`Open ${pick.name} details`}>
      <LeadCell>
        <div className="flex min-w-0 items-center gap-2.5">
          <ModelLogo
            modelId={pick.hfId}
            author={owner}
            label={pick.name}
            size="sm"
            className="rounded-md"
          />
          <span className="min-w-0 truncate text-[length:var(--fs-md)] font-medium text-(--fg)">
            {pick.name}
          </span>
          <span className="shrink-0 text-[length:var(--fs-sm)] text-(--dim)/70">{owner}</span>
          <span className="shrink-0 rounded border border-(--ui-border) px-1.5 py-px font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
            {badge.toUpperCase()}
          </span>
        </div>
      </LeadCell>

      <NumCell>
        <span className="text-[length:var(--fs-sm)] text-(--dim)/50">not rated</span>
      </NumCell>

      <NumCell>
        {pick.params ? `${pick.params}B` : "—"}
        {pick.activeParams && pick.activeParams !== pick.params ? (
          <span className="text-(--dim)/60"> · {pick.activeParams}B active</span>
        ) : null}
      </NumCell>

      <NumCell>{formatContext(pick.contextTokens)}</NumCell>

      <NumCell
        sub={<PoolCell fit={{ over: overPool }} poolGb={poolGb} requiredGb={pick.requiredGb} />}
      >
        <span className="text-(--fg)">{pick.filesize}</span>
      </NumCell>

      <EndCell>
        <RegistryStatusCell
          status={pick.status}
          download={download}
          isStarting={isStarting}
          onDownload={() => onDownload(pick.hfId)}
        />
      </EndCell>
    </DataRow>
  );
}

function PoolCell({
  fit,
  poolGb,
  requiredGb,
}: {
  fit: { over: boolean };
  poolGb: number;
  requiredGb: number;
}) {
  if (poolGb <= 0 || requiredGb <= 0) return <span>—</span>;
  if (fit.over) return <span>over pool</span>;
  const percent = (requiredGb / poolGb) * 100;
  return <span>{percent < 1 ? "<1% of pool" : `${Math.round(percent)}% of pool`}</span>;
}

function RegistryStatusCell({
  status,
  download,
  isStarting,
  onDownload,
}: {
  status: "validated" | "candidate";
  download: { status: string } | null;
  isStarting: boolean;
  onDownload: () => void;
}) {
  if (isStarting) return <StatusText>starting…</StatusText>;
  if (download?.status === "downloading" || download?.status === "paused") {
    return <StatusText>{downloadProgressText(download as never)}</StatusText>;
  }
  if (download?.status === "completed") return <StatusText>on disk</StatusText>;
  if (download?.status === "failed") return <StatusText tone="error">failed</StatusText>;
  return (
    <div className="flex items-center justify-end gap-2">
      <StatusPill tone={status === "validated" ? "good" : "info"}>{status}</StatusPill>
      <RowAction onClick={onDownload}>
        <DownloadCloud className="h-3 w-3" />
        Download
      </RowAction>
    </div>
  );
}
