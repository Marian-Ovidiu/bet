import type { AppConfig } from "@/config/loadConfig";
import type { SessionDiagnostics } from "@/types/diagnostics";

export interface ScannerContext {
  config: AppConfig;
  diagnostics: SessionDiagnostics;
}
