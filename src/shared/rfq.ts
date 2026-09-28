export type Rfq = {
  id: number;
  archiveDate: string;
  solicitationNumber: string;
  title: string;
  nsn: string | null;
  purchaseRequest: string | null;
  quantity: number | null;
  unit: string | null;
  issuedDate: string | null;
  closeDate: string | null;
  buyerName: string | null;
  buyerCode: string | null;
  buyerEmail: string | null;
  agency: string | null;
  supplyChain: string | null;
  naics: string | null;
  deliveryDays: number | null;
  estimatedUnitPrice: number | null;
  estimatedValue: number | null;
  filename: string;
  fileSize: number;
  createdAt: string;
  updatedAt: string;
};

export type RfqDay = {
  date: string;
  count: number;
  importedAt: string;
  lastCheckedAt: string;
  sourceName: string;
  sourceKind: "archive" | "live" | "manual";
};

export type RfqListResponse = {
  data: Rfq[];
  total: number;
  from: string;
  to: string;
};

export type SyncStatus = {
  syncType: "archive" | "live";
  targetDate: string;
  status: "complete" | "partial" | "failed";
  discoveredCount: number;
  importedCount: number;
  error: string | null;
  startedAt: string;
  completedAt: string;
};

export type SyncProgress = {
  active: boolean;
  operation: string;
  phase: string;
  current: number;
  total: number;
  message: string;
  startedAt: string | null;
};

export type ApprovedPart = {
  id: number;
  rfqId: number;
  cageCode: string;
  partNumber: string;
  manufacturer: string;
};
