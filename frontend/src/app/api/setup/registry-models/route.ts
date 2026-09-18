import { NextResponse, type NextRequest } from "next/server";
import { Effect } from "effect";
import {
  fetchRecipesRaw,
  lookupRegistryHardwareId,
  type RegistryFetchEffect,
} from "@shared/registry/registry-client";
import {
  transformCompactRowsGroupedByModel,
  type RegistryModelVariant,
} from "@shared/registry/registry-transform";
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

export interface RegistryModelVariantRow {
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

export interface RegistryModelRow {
  hfId: string;
  name: string;
  owner: string;
  variants: RegistryModelVariantRow[];
  bestVariant: RegistryModelVariantRow;
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

export async function GET(request: NextRequest): Promise<NextResponse> {
  const parameters = request.nextUrl.searchParams;
  const poolGb = Number(parameters.get("poolGb") ?? 0);
  const gpuName = parameters.get("gpuName")?.trim() ?? "";
  const limit = Math.min(Number(parameters.get("limit") ?? 12), 50);

  if (!Number.isFinite(poolGb) || poolGb <= 0) {
    return NextResponse.json({ updated: null, models: [] });
  }

  const hardwareId = gpuName
    ? await Effect.runPromise(
        lookupRegistryHardwareId(gpuName, nextFetch).pipe(
          Effect.catchCause(() => Effect.succeed(null)),
        ),
      )
    : null;

  let result: ReturnType<typeof transformCompactRowsGroupedByModel> | null = null;
  try {
    result = await Effect.runPromise(
      fetchRecipesRaw(nextFetch, hardwareId ?? undefined).pipe(
        Effect.map((response) =>
          transformCompactRowsGroupedByModel(response, {
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
    return NextResponse.json({ updated: null, models: [] });
  }

  const toVariant = (variant: RegistryModelVariant): RegistryModelVariantRow => ({
    recipeId: variant.recipeId,
    quant: variant.quant,
    precision: variant.precision,
    format: variant.format,
    filesizeGb: variant.filesizeGb,
    filesize: variant.filesize,
    requiredGb: variant.requiredGb,
    status: variant.status,
    engine: variant.engine,
    engineVersion: variant.engineVersion,
    architecture: variant.architecture,
    measuredOnThisClass: variant.measuredOnThisClass,
  });

  const rows: RegistryModelRow[] = result.models.slice(0, limit).map((model) => ({
    hfId: model.hfId,
    name: model.name,
    owner: model.owner,
    variants: model.variants.map(toVariant),
    bestVariant: toVariant(model.bestVariant),
    params: model.params,
    activeParams: model.activeParams,
    contextTokens: model.contextTokens,
    architecture: model.architecture,
    capabilities: model.capabilities,
    engines: [...model.engines],
    measuredOnThisClass: model.measuredOnThisClass,
  }));

  return NextResponse.json({ updated: result.updated, models: rows });
}
