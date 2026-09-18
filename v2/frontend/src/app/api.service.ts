import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export type Project = { id: number; name: string };
export type Conversation = { id: number; title: string; createdAt: string; updatedAt: string };
export type ChatMessage = { id?: number; role: 'user' | 'assistant' | 'tool'; content: string; metadata?: Record<string, unknown> };
export type Resource = { id: number; name: string; sizeBytes: number; preview: string };
export type Tool = { name: string; displayName: string; description: string; inputSchema: Record<string, string>; requiresApproval: boolean; version: string };
export type FlowNode = { id: string; type: 'planner' | 'executor' | 'reviewer' | 'router'; name: string; x: number; y: number; model: string; prompt: string; tools: string[]; memory: string[] };
export type FlowEdge = { id: string; source: string; target: string };
export type FlowGraph = { nodes: FlowNode[]; edges: FlowEdge[] };
export type Flow = { id: number; name: string; description: string; activeVersion: number; updatedAt: string; graph?: FlowGraph };
export type FlowTemplate = { key: string; name: string; description: string; graph: FlowGraph };
export type TraceItem = { nodeId: string; name: string; type: string; status: string; output?: string; reason?: string; invocationId?: number; tool?: string };
export type FlowRun = { id: number; flowId: number; version: number; status: string; task: string; currentNode: string; trace: TraceItem[]; output: string; error: string; pendingApproval?: { id: number; tool: string; arguments: Record<string, unknown> } | null };
export type MemoryEntry = { id: number; kind: 'episodic' | 'long_term' | 'project'; content: string; sourceType: string; sourceId: string; metadata: Record<string, unknown>; createdAt: string };
export type SearchResult = { type: 'memory' | 'resource'; id: number; kind: string; label: string; content: string; score: number };

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private readonly http: HttpClient) {}
  projects() { return firstValueFrom(this.http.get<{projects: Project[]}>('/api/projects')); }
  createProject(name: string) { return firstValueFrom(this.http.post<{project: Project}>('/api/projects', { name })); }
  deleteProject(projectId: number) { return firstValueFrom(this.http.delete<{deleted: boolean}>(`/api/projects/${projectId}`)); }
  conversations(projectId: number) { return firstValueFrom(this.http.get<{conversations: Conversation[]}>(`/api/projects/${projectId}/conversations`)); }
  createConversation(projectId: number) { return firstValueFrom(this.http.post<{conversation: Conversation}>(`/api/projects/${projectId}/conversations`, {})); }
  renameConversation(conversationId: number, title: string) { return firstValueFrom(this.http.patch<{conversation: Conversation}>(`/api/conversations/${conversationId}`, { title })); }
  deleteConversation(conversationId: number) { return firstValueFrom(this.http.delete<{deleted: boolean}>(`/api/conversations/${conversationId}`)); }
  messages(conversationId: number) { return firstValueFrom(this.http.get<{messages: ChatMessage[]}>(`/api/conversations/${conversationId}/messages`)); }
  resources(projectId: number) { return firstValueFrom(this.http.get<{resources: Resource[]}>(`/api/projects/${projectId}/resources`)); }
  tools() { return firstValueFrom(this.http.get<{tools: Tool[]}>('/api/tools')); }
  models() { return firstValueFrom(this.http.get<{data: Array<{id: string}>}>('/api/models')); }
  async upload(projectId: number, file: File) { const body = new FormData(); body.append('file', file); return firstValueFrom(this.http.post<{resource: Resource}>(`/api/projects/${projectId}/resources`, body)); }
  invoke(projectId: number, conversationId: number | null, tool: string, arguments_: Record<string, unknown>) { return firstValueFrom(this.http.post<{invocation: {id: number; status: string}}>(`/api/projects/${projectId}/tools/invocations`, { tool, conversationId, arguments: arguments_ })); }
  approve(invocationId: number) { return firstValueFrom(this.http.post<{invocation: {id: number; status: string; result: unknown}; assistant: ChatMessage | null; flowRunId?: number}>(`/api/tool-invocations/${invocationId}/approve`, {})); }
  decline(invocationId: number) { return firstValueFrom(this.http.post<{flowRunId?: number}>(`/api/tool-invocations/${invocationId}/decline`, {})); }
  flowTemplates() { return firstValueFrom(this.http.get<{templates: FlowTemplate[]}>('/api/flow-templates')); }
  flows(projectId: number) { return firstValueFrom(this.http.get<{flows: Flow[]}>(`/api/projects/${projectId}/flows`)); }
  createFlow(projectId: number, body: {templateKey?: string; name?: string; description?: string; graph?: FlowGraph}) { return firstValueFrom(this.http.post<{flow: Flow}>(`/api/projects/${projectId}/flows`, body)); }
  flow(flowId: number) { return firstValueFrom(this.http.get<{flow: Flow}>(`/api/flows/${flowId}`)); }
  renameFlow(flowId: number, name: string, description: string) { return firstValueFrom(this.http.patch<{flow: Flow}>(`/api/flows/${flowId}`, { name, description })); }
  saveFlowVersion(flowId: number, graph: FlowGraph) { return firstValueFrom(this.http.post<{flow: Flow; version: {version: number; graph: FlowGraph}}>(`/api/flows/${flowId}/versions`, { graph })); }
  flowVersions(flowId: number) { return firstValueFrom(this.http.get<{versions: Array<{id: number; version: number; graph: FlowGraph; createdAt: string}>}>(`/api/flows/${flowId}/versions`)); }
  flowRuns(flowId: number) { return firstValueFrom(this.http.get<{runs: FlowRun[]}>(`/api/flows/${flowId}/runs`)); }
  startFlow(flowId: number, task: string, conversationId: number | null) { return firstValueFrom(this.http.post<{run: FlowRun}>(`/api/flows/${flowId}/runs`, { task, conversationId })); }
  flowRun(runId: number) { return firstValueFrom(this.http.get<{run: FlowRun}>(`/api/flow-runs/${runId}`)); }
  memories(projectId: number) { return firstValueFrom(this.http.get<{memories: MemoryEntry[]}>(`/api/projects/${projectId}/memories`)); }
  createMemory(projectId: number, kind: MemoryEntry['kind'], content: string, conversationId?: number) { return firstValueFrom(this.http.post<{memory: MemoryEntry}>(`/api/projects/${projectId}/memories`, { kind, content, conversationId })); }
  deleteMemory(memoryId: number) { return firstValueFrom(this.http.delete(`/api/memories/${memoryId}`)); }
  search(projectId: number, query: string) { return firstValueFrom(this.http.post<{results: SearchResult[]}>(`/api/projects/${projectId}/search`, { query })); }
}
