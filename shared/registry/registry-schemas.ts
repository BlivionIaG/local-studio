import { Schema } from "effect";

export class RegistryFetchError extends Schema.TaggedErrorClass<RegistryFetchError>()(
  "RegistryFetchError",
  { message: Schema.String },
) {}

export class RegistryDecodeError extends Schema.TaggedErrorClass<RegistryDecodeError>()(
  "RegistryDecodeError",
  { message: Schema.String },
) {}

export class RegistryTimeoutError extends Schema.TaggedErrorClass<RegistryTimeoutError>()(
  "RegistryTimeoutError",
  { message: Schema.String },
) {}

export type RegistryError = RegistryFetchError | RegistryDecodeError | RegistryTimeoutError;

export const ProvenanceSchema = Schema.Struct({
  captured_at: Schema.optional(Schema.String),
});

export const HuggingFacePointerSchema = Schema.Struct({
  repository: Schema.optional(Schema.String),
});

export const ModelPointerSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  params: Schema.optional(Schema.NullOr(Schema.Number)),
  active_params: Schema.optional(Schema.NullOr(Schema.Number)),
  family: Schema.optional(Schema.String),
  architecture: Schema.optional(Schema.String),
  huggingface: Schema.optional(HuggingFacePointerSchema),
});

export const WeightsSchema = Schema.Struct({
  format: Schema.optional(Schema.String),
  precision: Schema.optional(Schema.String),
  size_gb: Schema.optional(Schema.NullOr(Schema.Number)),
});

export const ModelInstancePointerSchema = Schema.Struct({
  id: Schema.String,
  precision: Schema.optional(Schema.String),
  weights: Schema.optional(WeightsSchema),
  provenance: Schema.optional(ProvenanceSchema),
});

export const HardwareMemorySchema = Schema.Struct({
  vram_gb: Schema.optional(Schema.NullOr(Schema.Number)),
  cpu_memory_gb: Schema.optional(Schema.NullOr(Schema.Number)),
});

export const HardwarePointerSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  vendor: Schema.optional(Schema.String),
  memory_gb: Schema.optional(Schema.Number),
  accelerator_memory_gb: Schema.optional(Schema.Number),
  memory: Schema.optional(HardwareMemorySchema),
  accelerator: Schema.optional(Schema.Unknown),
  provenance: Schema.optional(ProvenanceSchema),
});

export const LaunchPointerSchema = Schema.Struct({
  kind: Schema.optional(Schema.String),
  image: Schema.optional(Schema.String),
  arguments: Schema.optional(Schema.Array(Schema.String)),
  environment: Schema.optional(Schema.Unknown),
  mounts: Schema.optional(Schema.Unknown),
});

export const EnginePointerSchema = Schema.Struct({
  name: Schema.String,
  version: Schema.optional(Schema.NullOr(Schema.String)),
  graph_mode: Schema.optional(Schema.NullOr(Schema.String)),
});

export const RecipeCapabilitiesSchema = Schema.Struct({
  chat: Schema.optional(Schema.NullOr(Schema.Boolean)),
  reasoning: Schema.optional(Schema.NullOr(Schema.Boolean)),
  tools: Schema.optional(Schema.NullOr(Schema.Boolean)),
  vision: Schema.optional(Schema.NullOr(Schema.Boolean)),
});

export const RecipeServingSchema = Schema.Struct({
  kv_cache_tokens: Schema.optional(Schema.NullOr(Schema.Number)),
  max_concurrency: Schema.optional(Schema.NullOr(Schema.Number)),
  max_context_tokens: Schema.optional(Schema.NullOr(Schema.Number)),
  tensor_parallel: Schema.optional(Schema.NullOr(Schema.Number)),
});

export const RecipePointerSchema = Schema.Struct({
  id: Schema.String,
  status: Schema.optional(Schema.String),
  launch: Schema.optional(LaunchPointerSchema),
  engine: Schema.optional(EnginePointerSchema),
  capabilities: Schema.optional(RecipeCapabilitiesSchema),
  serving: Schema.optional(RecipeServingSchema),
  provenance: Schema.optional(ProvenanceSchema),
});

export const SpeedEvidenceSchema = Schema.Struct({
  available: Schema.optional(Schema.Boolean),
  count: Schema.optional(Schema.Number),
  speed_sweep_ids: Schema.optional(Schema.Array(Schema.String)),
  detail_urls: Schema.optional(Schema.Array(Schema.String)),
});

export const RegistryHardwareSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  vendor: Schema.optional(Schema.String),
  memory_gb: Schema.optional(Schema.NullOr(Schema.Number)),
  accelerator_memory_gb: Schema.optional(Schema.NullOr(Schema.Number)),
});

export const RegistryHardwareListResponseSchema = Schema.Struct({
  data: Schema.Array(RegistryHardwareSchema),
  meta: Schema.optional(
    Schema.Struct({
      source: Schema.optional(Schema.String),
    }),
  ),
  links: Schema.optional(Schema.Unknown),
});

export const CompactRowSchema = Schema.Struct({
  id: Schema.String,
  launchable: Schema.optional(Schema.Boolean),
  model: ModelPointerSchema,
  model_instance: ModelInstancePointerSchema,
  hardware: HardwarePointerSchema,
  recipe: RecipePointerSchema,
  speed_evidence: Schema.optional(SpeedEvidenceSchema),
  links: Schema.optional(Schema.Unknown),
});

export const RecipeListResponseSchema = Schema.Struct({
  data: Schema.Array(CompactRowSchema),
  meta: Schema.optional(
    Schema.Struct({
      source: Schema.optional(Schema.String),
    }),
  ),
  links: Schema.optional(Schema.Unknown),
});

export type CompactRow = Schema.Schema.Type<typeof CompactRowSchema>;
export type RecipeListResponse = Schema.Schema.Type<typeof RecipeListResponseSchema>;
