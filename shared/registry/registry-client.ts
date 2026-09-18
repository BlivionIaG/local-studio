import { Duration, Effect, Schema } from "effect";
import type { ModelRecommendationsFile } from "../model-recommendations";
import {
  RecipeListResponseSchema,
  RegistryDecodeError,
  RegistryFetchError,
  RegistryTimeoutError,
  type RegistryError,
} from "./registry-schemas";
import { transformCompactRows } from "./registry-transform";

export type RegistryFetchEffect = (
  url: string,
  init?: RequestInit,
) => Effect.Effect<Response, RegistryFetchError>;

export const fetchEffect: RegistryFetchEffect = (url, init) =>
  Effect.tryPromise({
    try: (signal) =>
      fetch(url, {
        ...init,
        signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
      }),
    catch: (cause) =>
      new RegistryFetchError({ message: `registry fetch failed: ${String(cause)}` }),
  });

export const REGISTRY_BASE_URL = "https://local-ai-registry.vercel.app/api/v1";

export const REGISTRY_TIMEOUT_MS = 3000;

export const fetchRecipes = (
  fetchImpl: RegistryFetchEffect = fetchEffect,
): Effect.Effect<ModelRecommendationsFile, RegistryError> =>
  Effect.gen(function* () {
    const url = new URL(`${REGISTRY_BASE_URL}/recipes`);
    url.searchParams.set("launchable", "true");
    url.searchParams.set("limit", "100");
    const response = yield* fetchImpl(url.toString());
    if (!response.ok) {
      return yield* Effect.fail(
        new RegistryFetchError({ message: `registry HTTP ${response.status}` }),
      );
    }
    const body = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) =>
        new RegistryDecodeError({ message: `registry JSON parse failed: ${String(cause)}` }),
    });
    const decoded = yield* Schema.decodeUnknownEffect(RecipeListResponseSchema)(body).pipe(
      Effect.mapError(
        (cause) =>
          new RegistryDecodeError({ message: `registry schema decode failed: ${String(cause)}` }),
      ),
    );
    return transformCompactRows(decoded);
  }).pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(REGISTRY_TIMEOUT_MS),
      orElse: () =>
        Effect.fail(
          new RegistryTimeoutError({
            message: `registry timed out after ${REGISTRY_TIMEOUT_MS}ms`,
          }),
        ),
    }),
  );
