export type WikiPageDoc = {
  id: string; // basename without .md
  path: string; // absolute path
  relPath: string; // relative to vault
  title: string;
  aliases: string[];
  tags: string[];
  body: string;
  updated?: string;
};

export type CandidateHit = {
  id: string;
  path: string;
  relPath: string;
  title: string;
  score: number;
  reasons: string[];
  /** Excerpt snippets for the answerer */
  excerpts: string[];
};

export type CandidatesFile = {
  question: string;
  generatedAt: string;
  candidates: CandidateHit[];
};

export type CitationCheck = {
  id: string;
  ok: boolean;
  message: string;
};

export type CitationChecksFile = {
  ok: boolean;
  checks: CitationCheck[];
  verifiedAt: string;
};

export type AskStage =
  | "received"
  | "candidates"
  | "answered"
  | "verified"
  | "needs_human"
  | "done";

export type AskState = {
  id: string;
  stage: AskStage;
  question: string;
  createdAt: string;
  updatedAt: string;
  answerAttempts?: number;
  lastCheckErrors?: string[];
};
