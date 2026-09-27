// Shared types between apps/api and apps/web will land here as phases add
// features that need cross-package contracts (e.g. document DTOs).
export type Role =
  | "ADMIN"
  | "INVESTIGATING_OFFICER"
  | "SENIOR_OFFICER"
  | "FORENSIC_OFFICER"
  | "LEGAL_OFFICER";
