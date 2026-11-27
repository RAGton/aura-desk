export interface HindsightBankSummary {
  id: string;
  name: string;
  totalNodes: number;
  totalLinks: number;
  totalDocuments: number;
}

export interface HindsightBankStats {
  bankId: string;
  totalNodes: number;
  totalLinks: number;
  totalDocuments: number;
  nodesByFactType: Record<string, number>;
  linksByLinkType: Record<string, number>;
  pendingOperations: number;
  failedOperations: number;
  pendingConsolidation: number;
  failedConsolidation: number;
  lastConsolidatedAt?: string | null;
  lastMemoryWriteAt?: string | null;
}

export interface HindsightMemoryItem {
  id: string;
  text: string;
  context?: string | null;
  date?: string | null;
  factType?: string | null;
  documentId?: string | null;
  mentionedAt?: string | null;
  occurredStart?: string | null;
  occurredEnd?: string | null;
  entities: string[];
  tags: string[];
  chunkId?: string | null;
  proofCount: number;
  state?: string | null;
}

export interface HindsightMemoryPage {
  items: HindsightMemoryItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface HindsightMemoryHistoryEntry {
  id?: string | null;
  text?: string | null;
  changedAt?: string | null;
  createdAt?: string | null;
  occurredAt?: string | null;
  action?: string | null;
  raw: unknown;
}

export interface HindsightMemoryDetail {
  id: string;
  text: string;
  context?: string | null;
  date?: string | null;
  factType?: string | null;
  documentId?: string | null;
  mentionedAt?: string | null;
  occurredStart?: string | null;
  occurredEnd?: string | null;
  entities: string[];
  tags: string[];
  chunkId?: string | null;
  state?: string | null;
  sourceMemoryIds: string[];
  sourceMemories: HindsightMemoryItem[];
  history: HindsightMemoryHistoryEntry[];
}

export interface HindsightDocumentItem {
  id: string;
  bankId?: string | null;
  contentHash?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  textLength: number;
  memoryUnitCount: number;
  context?: string | null;
  tags: string[];
}

export interface HindsightDocumentPage {
  items: HindsightDocumentItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface HindsightDocumentDetail {
  id: string;
  bankId?: string | null;
  originalText?: string | null;
  contentHash?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  memoryUnitCount: number;
  nodesByFactType: Record<string, number>;
  tags: string[];
  context?: string | null;
  metadata: unknown;
}

export interface HindsightEntityItem {
  id: string;
  canonicalName: string;
  mentionCount: number;
  firstSeen?: string | null;
  lastSeen?: string | null;
}

export interface HindsightEntityPage {
  items: HindsightEntityItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface HindsightEntityObservation {
  text: string;
  mentionedAt?: string | null;
}

export interface HindsightEntityDetail {
  id: string;
  canonicalName: string;
  mentionCount: number;
  firstSeen?: string | null;
  lastSeen?: string | null;
  observations: HindsightEntityObservation[];
}

export interface HindsightGraphNode {
  id: string;
  label: string;
  text: string;
  date?: string | null;
  context?: string | null;
  entities: string[];
  color?: string | null;
  factType?: string | null;
}

export interface HindsightGraphEdge {
  id: string;
  source: string;
  target: string;
  linkType?: string | null;
  weight?: number | null;
  entityName?: string | null;
  color?: string | null;
  lineStyle?: string | null;
}

export interface HindsightGraphPayload {
  nodes: HindsightGraphNode[];
  edges: HindsightGraphEdge[];
  totalUnits: number;
}

export interface HindsightMentalModel {
  id: string;
  bankId?: string | null;
  name: string;
  sourceQuery?: string | null;
  content?: string | null;
  tags: string[];
  lastRefreshedAt?: string | null;
  lastMemorySeenAt?: string | null;
  lastRefreshFailedAt?: string | null;
  createdAt?: string | null;
  isStale: boolean;
}

export interface HindsightMentalModelPage {
  items: HindsightMentalModel[];
  total: number;
  limit: number;
  offset: number;
}

export interface HindsightDirective {
  id: string;
  bankId?: string | null;
  name: string;
  content: string;
  priority: number;
  isActive: boolean;
  tags: string[];
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface HindsightOperation {
  id: string;
  bankId?: string | null;
  operationType: string;
  status: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  errorMessage?: string | null;
}

/** A tag in use inside a bank, with how many memories carry it. */
export interface HindsightTag {
  tag: string;
  count: number;
}

export interface HindsightGlobalSearchHit {  id: string;
  bankId: string;
  bankName: string;
  text: string;
  context?: string | null;
  factType?: string | null;
  date?: string | null;
  documentId?: string | null;
  entities: string[];
  tags: string[];
  matchKind: string;
}

export interface HindsightGalaxyGlobe {
  id: string;
  bankId: string;
  bankName: string;
  title: string;
  content: string;
  factType: string;
  date?: string | null;
  context?: string | null;
  documentId?: string | null;
  entities: string[];
  tags: string[];
}

export interface HindsightGalaxyLink {
  source: string;
  target: string;
  bankId: string;
  linkType?: string | null;
  weight: number;
  entityName?: string | null;
}

export interface HindsightGalaxySnapshot {
  online: boolean;
  banks: HindsightBankSummary[];
  globes: HindsightGalaxyGlobe[];
  links: HindsightGalaxyLink[];
  totalRealNodes: number;
}

export interface KnowledgeRelationEntry {
  id: string;
  source: string;
  target: string;
  description: string;
  keywords: string[];
  weight: number;
  sourceId?: string | null;
}

export interface KnowledgeDocumentEntry {
  id: string;
  title: string;
  sourcePath?: string | null;
  status: string;
  contentPreview: string;
  contentLength: number;
  chunksCount: number;
  entities: string[];
  updatedAt?: string | null;
  origin: string;
}

export interface KnowledgeDocumentDetail {
  id: string;
  title: string;
  sourcePath?: string | null;
  content: string;
  status: string;
  entities: string[];
  relations: KnowledgeRelationEntry[];
  origin: string;
}

export interface KnowledgeEntityEntry {
  id: string;
  name: string;
  entityType: string;
  description: string;
  sourceId?: string | null;
}

export interface KnowledgeExplorerOverview {
  serviceKind: string;
  online: boolean;
  baseUrl: string;
  documentsCount: number;
  entitiesCount: number;
  relationsCount: number;
  configuredFolders: string[];
  localFileCount: number;
  statusCounts: Record<string, number>;
  diagnosticMessage?: string | null;
}

export interface KnowledgeDocumentsResult {
  serviceKind: string;
  online: boolean;
  documents: KnowledgeDocumentEntry[];
  diagnosticMessage?: string | null;
}

export interface KnowledgeGraphPayload {
  serviceKind: string;
  online: boolean;
  entities: KnowledgeEntityEntry[];
  relations: KnowledgeRelationEntry[];
  diagnosticMessage?: string | null;
}

export interface KnowledgeSearchResult {
  serviceKind: string;
  online: boolean;
  answer: string;
  sources: string[];
  matchingDocuments: KnowledgeDocumentEntry[];
  matchingEntities: KnowledgeEntityEntry[];
  matchingRelations: KnowledgeRelationEntry[];
  diagnosticMessage?: string | null;
}

export interface ChatSession {
  id: string;
  title: string;
  status: "active" | "archived" | "compressed" | string;
  semanticSummary: string;
  contextState: "normal" | "approaching_limit" | "compressed" | string;
  compressionState: "idle" | "auto_compressed" | "manual_compressed" | string;
  compressionCount: number;
  estimatedTokens: number;
  tokenBudget: number;
  model?: string | null;
  provider?: string | null;
  associatedMemories: string[];
  toolsUsed: string[];
  messageCount: number;
  lastMessagePreview?: string | null;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

export interface ContextLayerSnapshot {
  kind: string;
  label: string;
  tokenCount: number;
  itemCount: number;
  preview: string;
}

export interface ContextEventRecord {
  id: string;
  sessionId: string;
  kind: string;
  reason: string;
  tokensBefore: number;
  tokensAfter: number;
  messagesCompressed: number;
  preservedMessageIds: string[];
  retrievedMemoryIds: string[];
  layers: ContextLayerSnapshot[];
  createdAt: string;
}

export interface ContextInspection {
  session: ChatSession;
  layers: ContextLayerSnapshot[];
  totalTokens: number;
  tokenBudget: number;
  usagePct: number;
  totalHistoryMessages: number;
  events: ContextEventRecord[];
}

export interface AgentDescriptor {
  role: string;
  name: string;
  responsibility: string;
  status: string;
  capabilities: string[];
  safetyBoundary: string;
}

export interface AgentToolEntry {
  toolName: string;
  agentRole: string;
  description: string;
  permission: "allow" | "require_approval" | "deny" | string;
  riskLevel: "read" | "write" | "privileged" | "destructive" | string;
  enabled: boolean;
  source: string;
}

export interface AgentPlanStep {
  step: number;
  agentRole: string;
  toolName: string;
  action: string;
  requiresApproval: boolean;
}

export interface AgentRunRecord {
  id: string;
  sessionId?: string | null;
  agentRole: string;
  goal: string;
  plan: AgentPlanStep[];
  status: string;
  resultSummary?: string | null;
  createdAt: string;
}

export interface AgentBotRecord {
  id: string;
  slug: string;
  name: string;
  roleKind: string;
  icon: string;
  description: string;
  systemPrompt: string;
  preferredProvider?: string | null;
  preferredModel?: string | null;
  hindsightBank?: string | null;
  skillIds: string[];
  enabled: boolean;
  pinnedInChat: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertBotInput {
  id?: string | null;
  name: string;
  roleKind?: string | null;
  icon?: string | null;
  description?: string | null;
  systemPrompt?: string | null;
  preferredProvider?: string | null;
  preferredModel?: string | null;
  hindsightBank?: string | null;
  skillIds?: string[] | null;
  enabled?: boolean | null;
  pinnedInChat?: boolean | null;
}

export interface AgentSkillRecord {
  id: string;
  slug: string;
  name: string;
  description: string;
  version: string;
  sourceKind:
    | "builtin"
    | "local_dir"
    | "git_repo"
    | "catalog"
    | "antigravity_import"
    | "hermes_import"
    | string;
  sourceUri: string;
  installPath: string;
  skillMarkdown: string;
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
}

export interface InstallSkillInput {
  name: string;
  description?: string | null;
  version?: string | null;
  sourceKind?: string | null;
  sourceUri?: string | null;
  skillMarkdown?: string | null;
}

export interface McpPluginRecord {
  id: string;
  slug: string;
  name: string;
  transport: "stdio" | "http_sse" | string;
  commandOrUrl: string;
  args: string[];
  envVars: string[];
  enabled: boolean;
  lastHealthStatus: "healthy" | "degraded" | "offline" | "unknown" | string;
  lastHealthCheckedAt?: string | null;
  discoveredTools: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UpsertMcpPluginInput {
  id?: string | null;
  name: string;
  transport: string;
  commandOrUrl: string;
  args?: string[] | null;
  envVars?: string[] | null;
  enabled?: boolean | null;
}

export interface AgentsOverview {
  agents: AgentDescriptor[];
  tools: AgentToolEntry[];
  runs: AgentRunRecord[];
  pendingProposals: number;
  bots?: AgentBotRecord[];
  skills?: AgentSkillRecord[];
  mcpPlugins?: McpPluginRecord[];
}

export interface AgentExecutionSummary {
  runId: string;
  status: string;
  goal: string;
  completedSteps: number;
  totalSteps: number;
  finalResult?: unknown;
  error?: string | null;
  eventsCount: number;
}

export interface UnifiedCapability {
  id: string;
  name: string;
  description: string;
  permission: string;
  status: string;
  tags: string[];
}

export interface SelectedCapability {
  capability: UnifiedCapability;
  relevanceScore: number;
  reason: string;
}
