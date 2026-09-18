import type {
  HardwareTarget,
  ModelRecommendation,
  ModelRecommendationsFile,
  QuantKind,
  RecommendationEngine,
} from "../model-recommendations";
import type { CompactRow, RecipeListResponse } from "./registry-schemas";

const GGUF_QUANT_RE = /^(q[0-9]|iq[0-9]|ud-q|aq)/i;
const AWQ_FAMILY_RE = /^(mq4|mq4-awq|awq)/i;
const EXL3_RE = /^(exl3|.*bpw.*exl3|.*\d+\s*bpw)/i;

export interface EnrichedRegistryPick {
  readonly recipeId: string;
  readonly hfId: string;
  readonly name: string;
  readonly quant: QuantKind;
  readonly filesizeGb: number;
  readonly filesize: string;
  readonly requiredGb: number;
  readonly status: "validated" | "candidate";
  readonly params: string | null;
  readonly activeParams: string | null;
  readonly contextTokens: number | null;
  readonly architecture: string | null;
  readonly capabilities: {
    readonly chat: boolean;
    readonly reasoning: boolean;
    readonly tools: boolean;
    readonly vision: boolean;
  };
  readonly engine: string | null;
  readonly engineVersion: string | null;
  readonly hardwareId: string;
  readonly hardwareLabel: string;
  readonly measuredOnThisClass: boolean;
}

export interface EnrichedRegistryPicks {
  readonly updated: string;
  readonly picks: readonly EnrichedRegistryPick[];
}

export const transformCompactRowsEnriched = (
  response: RecipeListResponse,
  rig?: { poolGb: number; hardwareId: string | null },
): EnrichedRegistryPicks => {
  const updated = deriveUpdated(response.data);
  const picks: EnrichedRegistryPick[] = [];
  for (const row of response.data) {
    const repository = row.model.huggingface?.repository;
    if (!repository) continue;
    const filesizeGb = weightsToFilesizeGb(row.model_instance.weights);
    const requiredGb = Math.ceil(filesizeGb * 1.5);
    const hardwareMinMemoryGb = hardwareMemoryGb(row.hardware);
    if (rig) {
      if (rig.hardwareId && row.hardware.id !== rig.hardwareId) continue;
      if (rig.poolGb > 0 && rig.poolGb < requiredGb) continue;
    }
    const caps = row.recipe.capabilities;
    const serving = row.recipe.serving;
    picks.push({
      recipeId: row.id,
      hfId: repository,
      name: row.model.name ?? repository.split("/").at(-1) ?? repository,
      quant: precisionToQuant(
        row.model_instance.weights?.format,
        row.model_instance.weights?.precision,
      ),
      filesizeGb,
      filesize: `${filesizeGb}gb`,
      requiredGb,
      status: (row.recipe.status === "validated" ? "validated" : "candidate"),
      params: row.model.params != null ? String(row.model.params) : null,
      activeParams: row.model.active_params != null ? String(row.model.active_params) : null,
      contextTokens: serving?.max_context_tokens ?? null,
      architecture: row.model.architecture ?? null,
      capabilities: {
        chat: caps?.chat ?? false,
        reasoning: caps?.reasoning ?? false,
        tools: caps?.tools ?? false,
        vision: caps?.vision ?? false,
      },
      engine: row.recipe.engine?.name ?? null,
      engineVersion: row.recipe.engine?.version ?? null,
      hardwareId: row.hardware.id,
      hardwareLabel: row.hardware.name ?? row.hardware.id,
      measuredOnThisClass: row.hardware.id === rig?.hardwareId,
    });
  }
  return { updated, picks };
};

const precisionToQuantFromPrecision = (precision: string | undefined): QuantKind => {
  if (!precision) return "bf16";
  const p = precision.toLowerCase();
  if (p === "gguf" || GGUF_QUANT_RE.test(p)) return "gguf";
  if (AWQ_FAMILY_RE.test(p)) return "awq";
  switch (p) {
    case "bf16":
      return "bf16";
    case "fp8":
      return "fp8";
    case "nvfp4":
      return "nvfp4";
    case "gptq":
      return "gptq";
    case "awq":
      return "awq";
    case "mlx":
      return "mlx";
    case "exl3":
    case "exl3 trellis tr3":
      return "exl3";
    default:
      return "bf16";
  }
};

export const precisionToQuant = (
  format: string | undefined,
  precision: string | undefined,
): QuantKind => {
  if (format) {
    switch (format) {
      case "safetensors":
        return precisionToQuantFromPrecision(precision);
      case "GGUF":
        return "gguf";
      case "GPTQ":
        return "gptq";
      case "AWQ":
        return "awq";
      case "ModelOpt":
        return precisionToQuantFromPrecision(precision);
      case "SGLang layered FP8":
        return "fp8";
    }
    if (format.startsWith("EXL3")) return "exl3";
  }
  if (precision && (precision.toLowerCase() === "gguf" || GGUF_QUANT_RE.test(precision))) {
    return "gguf";
  }
  if (precision && AWQ_FAMILY_RE.test(precision)) {
    return "awq";
  }
  if (precision && EXL3_RE.test(precision.toLowerCase())) {
    return "exl3";
  }
  return "bf16";
};

export const engineToRecommendationEngine = (
  engineName: string | undefined,
): RecommendationEngine => {
  switch (engineName?.toLowerCase()) {
    case "vllm":
      return "vllm";
    case "sglang":
      return "sglang";
    case "llamacpp":
    case "llama.cpp":
    case "llama-cpp":
      return "llamacpp";
    case "mlx":
      return "mlx";
    case "exllamav3":
    case "tabbyapi":
      return "exllamav3";
    default:
      return "vllm";
  }
};

const UNIFIED_ID_HINTS = ["apple", "gb", "spark", "m1", "m2", "m3", "m4", "m5"];

const isUnifiedMemory = (id: string, vendor: string | undefined): boolean => {
  const lowerId = id.toLowerCase();
  if (UNIFIED_ID_HINTS.some((hint) => lowerId.includes(hint))) return true;
  const lowerVendor = vendor?.toLowerCase();
  return lowerVendor != null && lowerVendor.includes("apple");
};

export const weightsToFilesizeGb = (weights?: { size_gb?: number | null }): number =>
  weights?.size_gb ?? 0;

export const hardwareMemoryGb = (hardware: {
  memory?: { vram_gb?: number | null; cpu_memory_gb?: number | null };
}): number => hardware.memory?.vram_gb ?? hardware.memory?.cpu_memory_gb ?? 0;

const deriveUpdated = (rows: readonly CompactRow[]): string => {
  let latest: number | null = null;
  for (const row of rows) {
    const candidates = [
      row.recipe.provenance?.captured_at,
      row.model_instance.provenance?.captured_at,
      row.hardware.provenance?.captured_at,
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const parsed = new Date(candidate).getTime();
      if (Number.isNaN(parsed)) continue;
      if (latest === null || parsed > latest) latest = parsed;
    }
  }
  if (latest !== null) return new Date(latest).toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
};

const buildHardwareTarget = (row: CompactRow): HardwareTarget => ({
  id: row.hardware.id,
  label: row.hardware.name ?? row.hardware.id,
  minMemoryGb: hardwareMemoryGb(row.hardware),
  gpuCount: 1,
  unifiedMemory: isUnifiedMemory(row.hardware.id, row.hardware.vendor),
  tested: true,
});

const dedupeHardware = (rows: Array<{ hardware: HardwareTarget }>): HardwareTarget[] => {
  const byId = new Map<string, HardwareTarget>();
  for (const row of rows) {
    const target = row.hardware;
    const existing = byId.get(target.id);
    if (!existing) {
      byId.set(target.id, target);
    } else if (target.minMemoryGb > existing.minMemoryGb) {
      byId.set(target.id, target);
    }
  }
  return [...byId.values()];
};

export const transformCompactRows = (response: RecipeListResponse): ModelRecommendationsFile => {
  const groups = new Map<string, Array<{ row: CompactRow; rank: number }>>();
  response.data.forEach((row, index) => {
    const repository = row.model.huggingface?.repository;
    if (!repository) return;
    const entry = { row, rank: index + 1 };
    const existing = groups.get(repository);
    if (existing) existing.push(entry);
    else groups.set(repository, [entry]);
  });

  const models: Record<string, ModelRecommendation> = {};
  for (const [repository, entries] of groups) {
    const first = entries[0].row;
    const filesizeGb = Math.round(weightsToFilesizeGb(first.model_instance.weights) * 10) / 10;
    const commands: Partial<Record<RecommendationEngine, string>> = {};
    for (const entry of entries) {
      const args = entry.row.recipe.launch?.arguments ?? [];
      if (args.length > 0) {
        commands[engineToRecommendationEngine(entry.row.recipe.engine?.name)] = args.join(" ");
      }
    }
    models[repository] = {
      name: first.model.name ?? repository.split("/").at(-1) ?? repository,
      quant: precisionToQuant(
        first.model_instance.weights?.format,
        first.model_instance.weights?.precision,
      ),
      filesizeGb,
      filesize: `${filesizeGb}gb`,
      hardware: dedupeHardware(
        entries.map((entry) => ({ hardware: buildHardwareTarget(entry.row) })),
      ),
      commands,
      rank: Math.min(...entries.map((entry) => entry.rank)),
      benchmarks: [],
      expectSpeed: { decodeTps: null, prefillTps: null, source: "estimated" },
      params: first.model.params != null ? String(first.model.params) : null,
      notes: [],
    };
  }
  return {
    version: 1,
    updated: deriveUpdated(response.data),
    models,
  };
};