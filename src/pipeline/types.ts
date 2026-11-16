export type JobStage =
  | "queued"
  | "received"
  | "fetched"
  | "prepared"
  | "summarized"
  | "integrated"
  | "verified"
  | "awaiting_approval"
  | "applied"
  | "needs_human"
  | "rejected";

export type IngestRequest = {
  id: string;
  url: string;
  note?: string;
  createdAt: string;
};

export type CheckResult = {
  id: string;
  ok: boolean;
  message: string;
};

export type ChecksFile = {
  ok: boolean;
  checks: CheckResult[];
  verifiedAt: string;
};

export type ApprovalFile = {
  decision: "approve" | "reject";
  comment?: string;
  decidedAt: string;
};

export type JobState = {
  id: string;
  stage: JobStage;
  request: IngestRequest;
  updatedAt: string;
  /** 1 = first integrate; retries increment this */
  integrateAttempts?: number;
  lastVerifyErrors?: string[];
};
