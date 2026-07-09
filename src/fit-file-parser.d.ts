declare module "fit-file-parser" {
  export interface FitParserOptions {
    force?: boolean;
    mode?: "cascade" | "list" | "both";
    elapsedRecordField?: boolean;
    speedUnit?: "m/s" | "km/h" | "mph";
    lengthUnit?: "m" | "km" | "mi";
    temperatureUnit?: "celsius" | "kelvin" | "fahrenheit";
    pressureUnit?: "bar" | "cbar" | "psi";
  }

  export default class FitParser {
    constructor(options?: FitParserOptions);
    parse(
      content: ArrayBuffer | ArrayBufferView,
      callback: (error: string | null, data: unknown) => void
    ): void;
  }
}
