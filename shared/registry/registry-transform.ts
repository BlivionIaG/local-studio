import type {
  ModelRecommendation,
  ModelRecommendationsFile,
  QuantKind,
  RecommendationEngine,
} from "../model-recommendations";
import type { RecipeListResponse } from "./registry-schemas";

export const precisionToQuant = (precision: string | undefined): QuantKind => {
  switch (precision?.toLowerCase()) {
    case "fp8":
      return "fp8";
    case "nvfp4":
      return "nvfp4";
    case "awq":
      return "awq";
    case "gptq":
      return "gptq";
    case "gguf":
      return "gguf";
    case "mlx":
      return "mlx";
    case "exl3":
      return "exl3";
    case "mixed-bit":
      return "mixed-bit";
    case "4bit":
      return "awq";
    default:
      return "bf16";
  }
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
      return "llamacpp";
    case "mlx":
      return "mlx";
    case "exllamav3":
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

const deriveUpdated = (source: string | undefined): string => {
  if (source) {
    const parsed = new Date(source);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }
  return new Date().toISOString().slice(0, 10);
};

export const transformCompactRows = (response: RecipeListResponse): ModelRecommendationsFile => {
  const models: Record<string, ModelRecommendation> = {};
  response.data.forEach((row, index) => {
    const repository = row.model.huggingface?.repository;
    if (!repository) return;
    const filesizeGb = Math.round(((row.model_instance.weights ?? 0) / 1e9) * 10) / 10;
    const args = row.recipe.launch?.arguments ?? [];
    const commands: Partial<Record<RecommendationEngine, string>> = {};
    if (args.length > 0) {
      commands[engineToRecommendationEngine(row.recipe.engine?.name)] = args.join(" ");
    }
    models[repository] = {
      name: row.model.name ?? repository.split("/").at(-1) ?? repository,
      quant: precisionToQuant(row.model_instance.precision),
      filesizeGb,
      filesize: `${filesizeGb}gb`,
      hardware: [
        {
          id: row.hardware.id,
          label: row.hardware.name ?? row.hardware.id,
          minMemoryGb: row.hardware.memory_gb ?? row.hardware.accelerator_memory_gb ?? 0,
          gpuCount: 1,
          unifiedMemory: isUnifiedMemory(row.hardware.id, row.hardware.vendor),
          tested: true,
        },
      ],
      commands,
      rank: index + 1,
      benchmarks: [],
      expectSpeed: { decodeTps: null, prefillTps: null, source: "estimated" },
      params: row.model.params != null ? String(row.model.params) : null,
      notes: [],
    };
  });
  return {
    version: 1,
    updated: deriveUpdated(response.meta?.source),
    models,
  };
};
