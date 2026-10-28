import { analysisEvidenceSources } from "../application/AnalysisEvidenceSources.js";
import type { AnalysisViewRequest } from "../domain/analysisView/analysisView.js";
import { z } from "incur";
import {
  parseEvidence,
  withEvidenceCallerInputPath,
  type Evidence,
} from "../domain/evidence.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { redactExplicitFailure } from "../domain/explicitSensitiveFailure.js";
import { err, ok, type Result } from "../domain/result.js";
import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import { createEvidenceBundle } from "../domain/evidenceBundle.js";
import { publishEvidenceDelivery } from "../application/EvidenceBundleCommands.js";
import { inspectAnalysisViewValidated } from "../application/analysisView/AnalysisViewService.js";
import { localPathStringSchema } from "../domain/localPath.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import { finishAnalysisCommand } from "./finishAnalysisCommand.js";
import { projectCliAnalysisResult } from "./projectCliAnalysisResult.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import type { ZodSafeParseResult } from "zod";

export const analysisEvidenceDeliveryOptions = {
  detail: z
    .enum(["complete", "summary"])
    .default("complete")
    .describe("Deliver complete Evidence, or a summary with --evidence_output"),
  evidence_output: localPathStringSchema
    .optional()
    .describe(
      "Save complete Evidence as a bundle; required for summary delivery. Never overwrites.",
    ),
};

interface CliEvidenceDelivery {
  readonly view?: AnalysisViewRequest;
  readonly providerId: string;
  readonly operation: string;
  readonly signal: AbortSignal;
  readonly detail: "complete" | "summary";
  readonly evidenceOutput: string | undefined;
  /** Derived workflows publish their selected source closure with the result. */
  readonly sourceEvidence?: readonly Evidence[];
  /** Invocation exclusions cover final cleanup and publication paths/diagnostics. */
  readonly sensitiveValues?: readonly string[];
}

export const cliEvidenceDeliveryInputError = (
  input: Pick<CliEvidenceDelivery, "detail" | "evidenceOutput" | "operation">,
): AnalysisInputError | undefined =>
  input.detail === "summary" && input.evidenceOutput === undefined
    ? new AnalysisInputError(input.operation, undefined, [
        {
          path: ["evidence_output"],
          reason: "invalid_value",
          message:
            "Summary delivery requires --evidence_output so complete source Evidence remains available.",
        },
      ])
    : undefined;

/** Parse delivery JSON once and enforce its owning schema before opening a target. */
export const parseCliAnalysisEvidenceDelivery = <
  Delivery extends {
    readonly detail: "complete" | "summary";
    readonly view?: AnalysisViewRequest | undefined;
  },
>(
  operation: string,
  options: {
    readonly detail: "complete" | "summary";
    readonly evidence_output?: string | undefined;
    readonly view?: string | undefined;
  },
  schema: {
    readonly safeParse: (input: unknown) => ZodSafeParseResult<Delivery>;
  },
): Result<
  Delivery & { readonly evidenceOutput: string | undefined },
  AnalysisError
> => {
  let view: unknown;
  try {
    view = options.view === undefined ? undefined : JSON.parse(options.view);
  } catch (cause) {
    return err(
      new AnalysisInputError(operation, { cause }, [
        {
          path: ["view"],
          reason: "invalid_format",
          message: "view must be valid JSON",
        },
      ]),
    );
  }
  const raw = {
    detail: options.detail,
    ...(view === undefined ? {} : { view }),
  };
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    return err(
      analysisInputErrorFromIssues(operation, parsed.error.issues, raw),
    );
  const value = { ...parsed.data, evidenceOutput: options.evidence_output };
  const invalid = cliEvidenceDeliveryInputError({ ...value, operation });
  return invalid === undefined ? ok(value) : err(invalid);
};

/** One-shot delivery owns report publication; analysis keeps its own cleanup owner. */
export const deliverCliAnalysisEvidence = async (
  input: CliEvidenceDelivery & {
    readonly run: () => Promise<Result<Evidence, AnalysisError>>;
    readonly service: { close(): Promise<void> };
  },
) => {
  const {
    run,
    service,
    providerId,
    operation,
    signal,
    detail,
    evidenceOutput,
  } = input;
  const redactFailure = (error: AnalysisError) =>
    redactExplicitFailure(error, input.sensitiveValues ?? []);
  const inputError = cliEvidenceDeliveryInputError(input);
  if (inputError !== undefined)
    return finishAnalysisCommand(
      async () => ({ ok: false, error: inputError }),
      service,
      providerId,
      operation,
      signal,
      undefined,
      { redactFailure },
    ).then(projectCliAnalysisResult);
  const complete = await finishAnalysisCommand(
    run,
    service,
    providerId,
    operation,
    signal,
    undefined,
    { redactFailure },
  );
  return publishCliAnalysisEvidence(complete, {
    providerId,
    operation,
    signal,
    detail,
    evidenceOutput,
    ...(input.sensitiveValues === undefined
      ? {}
      : { sensitiveValues: input.sensitiveValues }),
    ...(input.view === undefined ? {} : { view: input.view }),
    ...(input.sourceEvidence === undefined
      ? {}
      : { sourceEvidence: input.sourceEvidence }),
  });
};

/** Publish already finalized CLI analysis without opening a second provider/session. */
export const publishCliAnalysisEvidence = async (
  result: Result<Evidence, JsonValue>,
  input: CliEvidenceDelivery,
): Promise<JsonValue> => {
  const { detail, evidenceOutput } = input;
  const projectFailure = (error: AnalysisError) =>
    projectAnalysisError(
      redactExplicitFailure(error, input.sensitiveValues ?? []),
    );
  if (!result.ok)
    return evidenceOutput === undefined
      ? result.error
      : publishFailurePartialEvidence(result.error, evidenceOutput, input);
  const complete = parseEvidence(result.value);
  const inputError = cliEvidenceDeliveryInputError(input);
  if (inputError !== undefined) {
    inputError.retainPartialObservation(complete);
    return projectFailure(inputError);
  }
  if (evidenceOutput === undefined) return complete;
  const published = await publishDeliveredEvidence(
    complete,
    evidenceOutput,
    input,
  );
  if (!published.ok) return projectFailure(published.error);
  return detail === "summary"
    ? {
        summary: published.value.delivered,
        evidence_bundle: published.value.receipt,
      }
    : published.value.delivered;
};

/**
 * Project the requested view, then publish the complete bundle. Projection
 * runs first so a view failure cannot commit an unreported bundle;
 * publication then owns every post-commit outcome.
 */
const publishDeliveredEvidence = async (
  complete: Evidence,
  evidenceOutput: string,
  input: CliEvidenceDelivery,
): Promise<
  Result<
    { readonly delivered: Evidence; readonly receipt: JsonValue },
    AnalysisError
  >
> => {
  const delivered =
    input.detail === "summary"
      ? inspectAnalysisViewValidated({
          source: { kind: "inline", evidence: complete },
          view: input.view ?? { kind: "summary" },
        })
      : ok(complete);
  if (!delivered.ok)
    return err(delivered.error.retainPartialObservation(complete));
  // This projection answers the same direct invocation as its parent. Later
  // inspect_analysis_view calls own their own input and do not inherit it.
  const selected =
    input.detail === "summary" && complete.caller_input_path !== undefined
      ? withEvidenceCallerInputPath(delivered.value, complete.caller_input_path)
      : delivered.value;
  const inspectionSources = analysisEvidenceSources(complete);
  if (!inspectionSources.ok) return inspectionSources;
  const published = await publishEvidenceDelivery({
    bundle: createEvidenceBundle([
      ...new Map(
        [...(input.sourceEvidence ?? []), ...inspectionSources.value].map(
          (record) => [record.evidence_id, record],
        ),
      ).values(),
    ]),
    complete,
    delivered: selected,
    outputPath: absoluteCallerPath(evidenceOutput),
    operation: input.operation,
    signal: input.signal,
  });
  if (!published.ok) return published;
  const { path, bytes } = published.value.evidenceBundle;
  return ok({
    delivered: published.value.delivered,
    receipt: {
      ...(input.sensitiveValues?.some(
        (literal) => literal !== "" && path.includes(literal),
      )
        ? {}
        : { path }),
      bytes,
    },
  });
};

const isJsonObject = (
  value: JsonValue | undefined,
): value is { readonly [key: string]: JsonValue } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A failure that carries partial Evidence publishes it to --evidence_output
 * as a successful run would. The failure keeps its code, message and
 * remediation; with summary detail, the inline partial observation becomes
 * its summary view, and details.diagnostics.evidence_bundle names the file.
 * Cancellation keeps its no-publication contract, raw provider observations
 * stay inline, and a refused publication keeps the complete partial Evidence
 * inline with details.diagnostics.evidence_bundle_error.
 */
const publishFailurePartialEvidence = async (
  failure: JsonValue,
  evidenceOutput: string,
  input: CliEvidenceDelivery,
): Promise<JsonValue> => {
  if (
    input.signal.aborted ||
    !isJsonObject(failure) ||
    failure.code === "cancelled" ||
    !isJsonObject(failure.details) ||
    failure.details.partial_observation === undefined
  )
    return failure;
  const details = failure.details;
  const diagnostics = isJsonObject(details.diagnostics)
    ? details.diagnostics
    : {};
  let partial: Evidence;
  try {
    partial = parseEvidence(details.partial_observation);
  } catch {
    return failure;
  }
  const published = await publishDeliveredEvidence(
    partial,
    evidenceOutput,
    input,
  );
  if (!published.ok) {
    const refusal = projectAnalysisError(
      redactExplicitFailure(published.error, input.sensitiveValues ?? []),
    );
    // A publication can commit before a later cancellation; keep its receipt.
    const committed =
      isJsonObject(refusal.details) && isJsonObject(refusal.details.diagnostics)
        ? refusal.details.diagnostics.evidence_bundle
        : undefined;
    return {
      ...failure,
      details: {
        ...details,
        diagnostics: {
          ...diagnostics,
          ...(committed === undefined ? {} : { evidence_bundle: committed }),
          evidence_bundle_error: {
            code: refusal.code,
            message: refusal.message,
            limitation:
              committed === undefined
                ? "The partial Evidence was not published to --evidence_output; it remains complete in details.partial_observation."
                : "The partial Evidence was published to --evidence_output before delivery stopped; it also remains complete in details.partial_observation.",
          },
        },
      },
    };
  }
  return {
    ...failure,
    details: {
      ...details,
      partial_observation: published.value.delivered,
      diagnostics: { ...diagnostics, evidence_bundle: published.value.receipt },
    },
  };
};
