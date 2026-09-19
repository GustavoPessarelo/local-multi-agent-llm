import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export type Project = { id: number; name: string };
export type Conversation = { id: number; title: string; createdAt: string; updatedAt: string };
export type ChatMessage = { id?: number; role: 'user' | 'assistant' | 'tool'; content: string; metadata?: Record<string, unknown> };
export type Resource = { id: number; name: string; sizeBytes: number; preview: string };
export type Tool = { name: string; displayName: string; description: string; inputSchema: Record<string, string>; requiresApproval: boolean; version: string };
export type FlowNode = { id: string; name: string; x: number; y: number; systemPrompt: string };
export type FlowEdge = { id: string; source: string; target: string };
export type FlowGraph = { rootId: string; nodes: FlowNode[]; edges: FlowEdge[] };
export type Flow = { id: number; name: string; description: string; activeVersion: number; updatedAt: string; graph?: FlowGraph };
export type FlowTemplate = { key: string; name: string; description: string; graph: FlowGraph };
export type TraceAgent = { id: string; name: string };
export type RunEvent = {
  id: number; type: string; at: string; content?: string; message?: string; error?: string;
  agentId?: string; agentName?: string; fromAgentName?: string; toAgentName?: string;
  targetAgentId?: string | null; targetAgentName?: string | null; depth?: number; decision?: 'delegate' | 'final'; delegated?: boolean;
  objective?: string; instruction?: string; contextPreview?: string; memoryPreview?: string; result?: string; rawProtocol?: string;
  availableDelegations?: TraceAgent[]; durationMs?: number; invocationId?: number; tool?: string | null;
  arguments?: Record<string, unknown>; resultPreview?: string;
};
export type ChatRun = {
  id: number; conversationId: number; flowId: number | null; flowName: string | null; flowVersion: number | null;
  model: string; status: string; currentAgent: string; events: RunEvent[]; lastEventId: number; output: string; error: string;
  profilingEnabled: boolean; profilingFile: string; startedAt?: string | null; completedAt?: string | null; durationMs?: number | null;
  pendingApproval?: {id: number; tool: string; arguments: Record<string, unknown>} | null;
};
export type FlowRun = { id: number; flowId: number; version: number; status: string; task: string; currentNode: string; trace: unknown[]; output: string; error: string };
export type MemoryEntry = { id: number; kind: 'episodic' | 'long_term' | 'project'; content: string; sourceType: string; sourceId: string; metadata: Record<string, unknown>; createdAt: string };
export type SearchResult = { type: 'memory' | 'resource'; id: number; kind: string; label: string; content: string; score: number };

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private readonly http: HttpClient) {}
  session() { return firstValueFrom(this.http.get<{authenticated: boolean; username: string}>('/api/auth/session')); }
  login(usuario: string, senha: string) { return firstValueFrom(this.http.post<{authenticated: boolean; username: string}>('/api/auth/login', { usuario, senha })); }
  logout() { return firstValueFrom(this.http.post('/api/auth/logout', {})); }
  projects() { return firstValueFrom(this.http.get<{projects: Project[]}>('/api/projects')); }
  createProject(name: string) { return firstValueFrom(this.http.post<{project: Project}>('/api/projects', { name })); }
  deleteProject(id: number) { return firstValueFrom(this.http.delete(`/api/projects/${id}`)); }
  conversations(projectId: number) { return firstValueFrom(this.http.get<{conversations: Conversation[]}>(`/api/projects/${projectId}/conversations`)); }
  createConversation(projectId: number) { return firstValueFrom(this.http.post<{conversation: Conversation}>(`/api/projects/${projectId}/conversations`, {})); }
  renameConversation(id: number, title: string) { return firstValueFrom(this.http.patch<{conversation: Conversation}>(`/api/conversations/${id}`, { title })); }
  deleteConversation(id: number) { return firstValueFrom(this.http.delete(`/api/conversations/${id}`)); }
  messages(id: number) { return firstValueFrom(this.http.get<{messages: ChatMessage[]}>(`/api/conversations/${id}/messages`)); }
  startChat(id: number, body: {content: string; model: string; enabled_tools: string[]; flow_id: number | null; profiling_enabled: boolean}) { return firstValueFrom(this.http.post<{run: ChatRun}>(`/api/conversations/${id}/messages`, body)); }
  chatRun(id: number, after = 0) { return firstValueFrom(this.http.get<{run: ChatRun}>(`/api/chat-runs/${id}?after=${after}`)); }
  cancelChat(id: number) { return firstValueFrom(this.http.post<{run: ChatRun}>(`/api/chat-runs/${id}/cancel`, {})); }
  resources(projectId: number) { return firstValueFrom(this.http.get<{resources: Resource[]}>(`/api/projects/${projectId}/resources`)); }
  tools() { return firstValueFrom(this.http.get<{tools: Tool[]}>('/api/tools')); }
  models() { return firstValueFrom(this.http.get<{data: Array<{id: string}>}>('/api/models')); }
  async upload(projectId: number, file: File) { const body = new FormData(); body.append('file', file); return firstValueFrom(this.http.post<{resource: Resource}>(`/api/projects/${projectId}/resources`, body)); }
  invoke(projectId: number, conversationId: number | null, tool: string, arguments_: Record<string, unknown>) { return firstValueFrom(this.http.post<{invocation: {id: number}}>(`/api/projects/${projectId}/tools/invocations`, {tool, conversationId, arguments: arguments_})); }
  approve(id: number) { return firstValueFrom(this.http.post<{invocation: {result: unknown}; assistant: ChatMessage | null; chatRunId?: number}>(`/api/tool-invocations/${id}/approve`, {})); }
  decline(id: number) { return firstValueFrom(this.http.post<{chatRunId?: number}>(`/api/tool-invocations/${id}/decline`, {})); }
  flowTemplates() { return firstValueFrom(this.http.get<{templates: FlowTemplate[]}>('/api/flow-templates')); }
  flows(projectId: number) { return firstValueFrom(this.http.get<{flows: Flow[]}>(`/api/projects/${projectId}/flows`)); }
  createFlow(projectId: number, body: {templateKey?: string; name?: string; description?: string; graph?: FlowGraph}) { return firstValueFrom(this.http.post<{flow: Flow}>(`/api/projects/${projectId}/flows`, body)); }
  flow(id: number) { return firstValueFrom(this.http.get<{flow: Flow}>(`/api/flows/${id}`)); }
  renameFlow(id: number, name: string, description: string) { return firstValueFrom(this.http.patch(`/api/flows/${id}`, {name, description})); }
  saveFlowVersion(id: number, graph: FlowGraph) { return firstValueFrom(this.http.post<{version: {version: number; graph: FlowGraph}}>(`/api/flows/${id}/versions`, {graph})); }
  flowVersions(id: number) { return firstValueFrom(this.http.get<{versions: Array<{id: number; version: number; graph: FlowGraph; createdAt: string}>}>(`/api/flows/${id}/versions`)); }
  flowRuns(id: number) { return firstValueFrom(this.http.get<{runs: FlowRun[]}>(`/api/flows/${id}/runs`)); }
  memories(projectId: number) { return firstValueFrom(this.http.get<{memories: MemoryEntry[]}>(`/api/projects/${projectId}/memories`)); }
  createMemory(projectId: number, kind: MemoryEntry['kind'], content: string, conversationId?: number) { return firstValueFrom(this.http.post<{memory: MemoryEntry}>(`/api/projects/${projectId}/memories`, {kind, content, conversationId})); }
  deleteMemory(id: number) { return firstValueFrom(this.http.delete(`/api/memories/${id}`)); }
  search(projectId: number, query: string) { return firstValueFrom(this.http.post<{results: SearchResult[]}>(`/api/projects/${projectId}/search`, {query})); }
}
