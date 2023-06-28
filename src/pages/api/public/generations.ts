import { prisma } from "@/src/server/db";
import { ObservationLevel, ObservationType } from "@prisma/client";
import { type NextApiRequest, type NextApiResponse } from "next";
import { z } from "zod";
import { cors, runMiddleware } from "./cors";
import { verifyAuthHeaderAndReturnScope } from "@/src/features/publicApi/server/apiAuth";
import { checkApiAccessScope } from "@/src/features/publicApi/server/apiScope";

const GenerationsCreateSchema = z.object({
  traceId: z.string().nullish(),
  name: z.string().nullish(),
  startTime: z.string().datetime().nullish(),
  endTime: z.string().datetime().nullish(),
  model: z.string().nullish(),
  modelParameters: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean()]).nullish()
    )
    .nullish(),
  prompt: z.unknown().nullish(),
  completion: z.string().nullish(),
  usage: z.object({
    promptTokens: z.number().nullish(),
    completionTokens: z.number().nullish(),
    totalTokens: z.number().nullish(),
  }),
  metadata: z.unknown().nullish(),
  parentObservationId: z.string().nullish(),
  level: z.nativeEnum(ObservationLevel).nullish(),
  statusMessage: z.string().nullish(),
});

const GenerationPatchSchema = z.object({
  generationId: z.string(),
  name: z.string().nullish(),
  endTime: z.string().datetime().nullish(),
  model: z.string().nullish(),
  modelParameters: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean()]).nullish()
    )
    .nullish(),
  prompt: z.unknown().nullish(),
  completion: z.string().nullish(),
  usage: z.object({
    promptTokens: z.number().nullish(),
    completionTokens: z.number().nullish(),
    totalTokens: z.number().nullish(),
  }),
  metadata: z.unknown().nullish(),
  level: z.nativeEnum(ObservationLevel).nullish(),
  statusMessage: z.string().nullish(),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  await runMiddleware(req, res, cors);

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  // CHECK AUTH
  const authCheck = await verifyAuthHeaderAndReturnScope(
    req.headers.authorization
  );
  if (!authCheck.validKey)
    return res.status(401).json({
      success: false,
      message: authCheck.error,
    });
  // END CHECK AUTH

  if (req.method === "POST") {
    try {
      const {
        traceId,
        name,
        startTime,
        endTime,
        model,
        modelParameters,
        prompt,
        completion,
        usage,
        metadata,
        parentObservationId,
        level,
        statusMessage,
      } = GenerationsCreateSchema.parse(req.body);

      // CHECK ACCESS SCOPE
      const accessCheck = await checkApiAccessScope(authCheck.scope, [
        ...(traceId ? [{ type: "trace" as const, id: traceId }] : []),
        ...(parentObservationId
          ? [{ type: "observation" as const, id: parentObservationId }]
          : []),
      ]);
      if (!accessCheck)
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      // END CHECK ACCESS SCOPE

      const calculatedUsage = usage
        ? {
            ...usage,
            totalTokens:
              !usage.totalTokens &&
              (usage.promptTokens || usage.completionTokens)
                ? (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0)
                : usage.totalTokens,
          }
        : undefined;

      const newObservation = await prisma.observation.create({
        data: {
          ...(traceId
            ? { trace: { connect: { id: traceId } } }
            : {
                trace: {
                  create: {
                    name: name,
                    project: { connect: { id: authCheck.scope.projectId } },
                  },
                },
              }),
          type: ObservationType.GENERATION,
          name,
          startTime: startTime ? new Date(startTime) : undefined,
          endTime: endTime ? new Date(endTime) : undefined,
          metadata: metadata ?? undefined,
          model: model ?? undefined,
          modelParameters: modelParameters ?? undefined,
          input: prompt ?? undefined,
          output: completion ? { completion: completion } : undefined,
          usage: calculatedUsage,
          level: level ?? undefined,
          statusMessage: statusMessage ?? undefined,
          parent: parentObservationId
            ? { connect: { id: parentObservationId } }
            : undefined,
        },
      });

      res.status(201).json(newObservation);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "An unknown error occurred";
      res.status(400).json({
        success: false,
        message: "Invalid request data",
        error: errorMessage,
      });
    }
  } else if (req.method === "PATCH") {
    try {
      const { generationId, endTime, prompt, completion, usage, ...fields } =
        GenerationPatchSchema.parse(req.body);

      // CHECK ACCESS SCOPE
      const accessCheck = await checkApiAccessScope(authCheck.scope, [
        { type: "observation", id: generationId },
      ]);
      if (!accessCheck)
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      // END CHECK ACCESS SCOPE

      const calculatedUsage = usage
        ? {
            ...usage,
            totalTokens:
              !usage.totalTokens &&
              (usage.promptTokens || usage.completionTokens)
                ? (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0)
                : usage.totalTokens,
          }
        : undefined;

      const newObservation = await prisma.observation.update({
        where: { id: generationId },
        data: {
          endTime: endTime ? new Date(endTime) : undefined,
          input: prompt ?? undefined,
          output: completion ? { completion: completion } : undefined,
          usage: calculatedUsage,
          ...Object.fromEntries(
            Object.entries(fields).filter(
              ([_, v]) => v !== null && v !== undefined
            )
          ),
        },
      });

      res.status(201).json(newObservation);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "An unknown error occurred";
      res.status(400).json({
        success: false,
        message: "Invalid request data",
        error: errorMessage,
      });
    }
  }
}