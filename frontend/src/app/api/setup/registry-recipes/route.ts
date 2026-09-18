import { NextResponse, type NextRequest } from "next/server";
import { Effect } from "effect";
import {
  fetchRecipesRaw,
  lookupRegistryHardwareId,
  type RegistryFetchEffect,
} from "@shared/registry/registry-client";
import { transformCompactRowsEnriched } from "@shared/registry/registry-transform";
import { RegistryFetchError } from "@shared/registry/registry-schemas";

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

export interface RegistryRecipeRow {
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

export async function GET(request: NextRequest): Promise<NextResponse> {
  const parameters = request.nextUrl.searchParams;
  const poolGb = Number(parameters.get("poolGb") ?? 0);
  const gpuName = parameters.get("gpuName")?.trim() ?? "";
  const limit = Math.min(Number(parameters.get("limit") ?? 12), 50);

  if (!Number.isFinite(poolGb) || poolGb <= 0) {
    return NextResponse.json({ updated: null, picks: [] });
  }

  const hardwareId = gpuName
    ? await Effect.runPromise(
        lookupRegistryHardwareId(gpuName, nextFetch).pipe(
          Effect.catchCause(() => Effect.succeed(null)),
        ),
      )
    : null;

  let result: ReturnType<typeof transformCompactRowsEnriched> | null = null;
  try {
    result = await Effect.runPromise(
      fetchRecipesRaw(nextFetch, hardwareId ?? undefined).pipe(
        Effect.map((response) =>
          transformCompactRowsEnriched(response, {
            poolGb,
            hardwareId,
          }),
        ),
      ),
    );
  } catch {
    result = null;
  }

  if (!result) {
    return NextResponse.json({ updated: null, picks: [] });
  }

  const rows: RegistryRecipeRow[] = result.picks.slice(0, limit).map((pick) => ({
    recipeId: pick.recipeId,
    hfId: pick.hfId,
    name: pick.name,
    quant: pick.quant,
    precision: pick.precision,
    format: pick.format,
    filesizeGb: pick.filesizeGb,
    filesize: pick.filesize,
    requiredGb: pick.requiredGb,
    status: pick.status,
    params: pick.params,
    activeParams: pick.activeParams,
    contextTokens: pick.contextTokens,
    architecture: pick.architecture,
    capabilities: pick.capabilities,
    engine: pick.engine,
    engineVersion: pick.engineVersion,
    hardwareId: pick.hardwareId,
    hardwareLabel: pick.hardwareLabel,
    measuredOnThisClass: pick.measuredOnThisClass,
  }));

  return NextResponse.json({ updated: result.updated, picks: rows });
}
