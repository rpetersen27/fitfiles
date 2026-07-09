import FitParserModule, { type FitParserOptions } from "fit-file-parser";
import type { FitParseResult } from "./types.js";

type FitParserConstructor = new (options?: FitParserOptions) => {
  parse(
    content: ArrayBuffer | ArrayBufferView,
    callback: (error: string | null, data: unknown) => void
  ): void;
};

function resolveFitParserConstructor(moduleValue: unknown): FitParserConstructor {
  if (typeof moduleValue === "function") {
    return moduleValue as FitParserConstructor;
  }

  if (moduleValue && typeof moduleValue === "object") {
    const maybeDefault = (moduleValue as { default?: unknown }).default;

    if (typeof maybeDefault === "function") {
      return maybeDefault as FitParserConstructor;
    }

    if (maybeDefault && typeof maybeDefault === "object") {
      const nestedDefault = (maybeDefault as { default?: unknown }).default;

      if (typeof nestedDefault === "function") {
        return nestedDefault as FitParserConstructor;
      }
    }
  }

  throw new Error("Unsupported fit-file-parser module shape.");
}

const FitParser = resolveFitParserConstructor(FitParserModule);

const parserOptions: FitParserOptions = {
  force: true,
  mode: "both",
  elapsedRecordField: true,
  speedUnit: "m/s",
  lengthUnit: "m",
  temperatureUnit: "celsius"
};

export async function parseFit(
  buffer: ArrayBuffer | ArrayBufferView
): Promise<FitParseResult> {
  const parser = new FitParser(parserOptions);

  return new Promise((resolve, reject) => {
    parser.parse(buffer, (error, data) => {
      if (error) {
        reject(new Error(error));
        return;
      }

      resolve((data ?? {}) as FitParseResult);
    });
  });
}
