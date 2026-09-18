import { NextResponse, type NextRequest } from "next/server";
import { Effect } from "effect";
import recommendationsSource from "@shared/model-recommendations.json";
import {
  recommendationsForRig,
  requiredPoolGb,
  type ModelRecommendationsFile,
  type RigDescriptor,
} from "@shared/model-recommendations";
import {
  fetchRecipes,
  lookupRegistryHardwareId,
  type RegistryFetchEffect,
} from "@shared/registry/registry-client";
import { RegistryFetchError } from "@shared/registry/registry-schemas";

const FILE = recommendationsSource as unknown as ModelRecommendationsFile;

const nextFetch: RegistryFetchEffect = (url, init) =>
  Effect.tryPromise({
    try: (signal) =>
      fetch(url, {
        ...init,
        next: { revalidate: 3600 },
        signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
      }),
    catch: (cause) =>
      new RegistryFetchError({ message: `registry fetch failed: ${String(cause)}` }),
  });

export interface SetupRecommendationRow {
  hfId: string;
  name: string;
  quant: string;
  filesize: string;
  requiredGb: number;
  decodeTps: number | null;
  engine: string | null;
  measuredOnThisClass: boolean;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const parameters = request.nextUrl.searchParams;
  const rig: RigDescriptor = {
    memoryPoolGb: Number(parameters.get("poolGb") ?? 0),
    gpuCount: Number(parameters.get("gpuCount") ?? 0),
    unifiedMemory: parameters.get("unified") === "1",
    appleSilicon: parameters.get("apple") === "1",
  };
  const limit = Math.min(Number(parameters.get("limit") ?? 6), 20);
  const gpuName = parameters.get("gpuName")?.trim() ?? "";
  if (!Number.isFinite(rig.memoryPoolGb) || rig.memoryPoolGb <= 0) {
    return NextResponse.json({ updated: FILE.updated, picks: [] });
  }
  const hardwareId = gpuName
    ? await Effect.runPromise(
        lookupRegistryHardwareId(gpuName, nextFetch).pipe(
          Effect.catchCause(() => Effect.succeed(null)),
        ),
      )
    : null;
  const registryFile = await Effect.runPromise(
    fetchRecipes(nextFetch, hardwareId ?? undefined).pipe(
      Effect.catchCause(() => Effect.succeed(null)),
    ),
  );
  const file = registryFile ?? FILE;
  const picks: SetupRecommendationRow[] = recommendationsForRig(file, rig)
    .slice(0, limit)
    .map((pick) => {
      const tested = pick.hardware.filter((target) => target.tested);
      const closest = [...tested].sort(
        (a, b) =>
          Math.abs(a.minMemoryGb - rig.memoryPoolGb) - Math.abs(b.minMemoryGb - rig.memoryPoolGb),
      )[0];
      const row = closest
        ? pick.benchmarks.find((benchmark) => benchmark.hardwareId === closest.id)
        : pick.benchmarks[0];
      return {
        hfId: pick.hfId,
        name: pick.name,
        quant: pick.quant,
        filesize: pick.filesize,
        requiredGb: requiredPoolGb(pick),
        decodeTps: row?.decodeTps ?? null,
        engine: row?.engine ?? null,
        measuredOnThisClass: pick.measuredOnThisClass,
      };
    });
  return NextResponse.json({ updated: file.updated, picks });
}
