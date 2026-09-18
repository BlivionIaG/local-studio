"use client";

import { useCallback, useState } from "react";
import { DownloadCloud } from "@/ui/icon-registry";
import { ModelButton } from "@/ui";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { safeJson } from "@/features/agent/safe-json";
import { useDownloads } from "@/hooks/use-downloads";
import { cx } from "@/ui/utils";
import type { SetupRecommendation } from "@/features/setup/recommendations";
import { useHardwareProfile } from "./picks-shared";

interface RegistryPicksMeta {
  readonly picks: readonly SetupRecommendation[];
  readonly updated: string | null;
}

export function RegistryPicksSection() {
  const hardware = useHardwareProfile();
  const { downloadsByModel, startingModelIds, startDownload } = useDownloads();
  const [meta, setMeta] = useState<RegistryPicksMeta>({ picks: [], updated: null });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (hardware.poolGb <= 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        poolGb: String(Math.round(hardware.poolGb)),
        gpuCount: String(hardware.gpuCount),
        unified: hardware.appleSilicon ? "1" : "0",
        apple: hardware.appleSilicon ? "1" : "0",
        limit: "6",
      });
      const response = await fetch(`/api/setup/recommendations?${params}`, {
        cache: "no-store",
      });
      const payload = await safeJson<{
        picks?: SetupRecommendation[];
        updated?: string;
      }>(response);
      setMeta({ picks: payload.picks ?? [], updated: payload.updated ?? null });
    } catch {
      setMeta({ picks: [], updated: null });
    } finally {
      setLoading(false);
    }
  }, [hardware.appleSilicon, hardware.gpuCount, hardware.poolGb]);

  useMountSubscription(() => {
    void refresh();
  }, [refresh]);

  const handleDownload = useCallback(
    (hfId: string) => {
      void startDownload({ model_id: hfId }).catch(() => {});
    },
    [startDownload],
  );

  if (hardware.poolGb <= 0 || meta.picks.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between px-1">
        <span className="font-mono text-[length:var(--fs-sm)] text-(--ui-muted)">
          Live from registry
        </span>
        {meta.updated ? (
          <span
            className="font-mono text-[11px] text-(--ui-muted)"
            title="Registry snapshot date; older dates mean the embedded fallback was used"
          >
            updated {meta.updated}
          </span>
        ) : null}
      </div>
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
  return (
    <div className="group flex items-center gap-4 border-b border-(--ui-border)/60 px-4 py-3 transition-colors last:border-b-0 hover:bg-(--ui-hover)/40">
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
