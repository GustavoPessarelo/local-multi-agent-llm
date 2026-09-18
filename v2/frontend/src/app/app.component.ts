import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ApiService, ChatMessage, Conversation, Flow, FlowEdge, FlowGraph, FlowNode, FlowRun,
  FlowTemplate, MemoryEntry, Project, Resource, SearchResult, Tool,
} from './api.service';

type Page = 'chat' | 'flows' | 'config';
type ConfigTab = 'memory' | 'tools' | 'resources';
type Approval = { id: number; tool: string; arguments: Record<string, unknown>; created: boolean; flowRunId?: number };
type DeleteTarget = { type: 'conversation' | 'project'; id: number; name: string };

@Component({
  selector: 'lap-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit, OnDestroy {
  page: Page = 'chat';
  configTab: ConfigTab = 'memory';
  projects: Project[] = [];
  conversations: Conversation[] = [];
  resources: Resource[] = [];
  tools: Tool[] = [];
  models: string[] = [];
  messages: ChatMessage[] = [];
  flows: Flow[] = [];
  flowTemplates: FlowTemplate[] = [];
  flowVersions: Array<{id: number; version: number; graph: FlowGraph; createdAt: string}> = [];
  flowRuns: FlowRun[] = [];
  memories: MemoryEntry[] = [];
  searchResults: SearchResult[] = [];
  project: Project | null = null;
  conversation: Conversation | null = null;
  selectedFlow: Flow | null = null;
  graph: FlowGraph = { nodes: [], edges: [] };
  selectedNode: FlowNode | null = null;
  currentRun: FlowRun | null = null;
  model = 'google/gemma-3-4b';
  input = '';
  newProjectName = '';
  editingConversationTitle = '';
  error = '';
  notice = '';
  generationStatus = '';
  busy = false;
  creatingConversation = false;
  savingFlow = false;
  approval: Approval | null = null;
  deleteTarget: DeleteTarget | null = null;
  selectedTool = '';
  enabledTools: string[] = [];
  toolResourceId: number | null = null;
  toolQuery = 'SELECT * FROM source LIMIT 20';
  edgeSource = '';
  edgeTarget = '';
  flowTask = '';
  memoryKind: MemoryEntry['kind'] = 'project';
  memoryContent = '';
  memoryQuery = '';
  memoryBusy = false;
  private projectLoadToken = 0;
  private runPoll?: ReturnType<typeof setTimeout>;

  constructor(private readonly api: ApiService, private readonly changeDetector: ChangeDetectorRef) {}

  async ngOnInit() {
    try {
      const [projects, tools, templates] = await Promise.all([this.api.projects(), this.api.tools(), this.api.flowTemplates()]);
      this.projects = projects.projects;
      this.tools = tools.tools;
      this.flowTemplates = templates.templates;
      this.selectedTool = this.tools[0]?.name ?? '';
      try {
        this.models = (await this.api.models()).data.map(item => item.id).filter(id => !id.toLowerCase().includes('embed'));
        if (!this.models.includes(this.model) && this.models[0]) this.model = this.models[0];
      } catch { this.models = [this.model]; }
      if (this.projects[0]) await this.selectProject(this.projects[0]);
      else await this.createProject('Meu primeiro projeto');
    } catch (error) { this.fail(error); }
    finally { this.render(); }
  }

  ngOnDestroy() { if (this.runPoll) clearTimeout(this.runPoll); }

  async createProject(name = this.newProjectName) {
    if (!name.trim()) return;
    try {
      const response = await this.api.createProject(name.trim());
      this.projects = [response.project, ...this.projects];
      this.newProjectName = '';
      await this.selectProject(response.project);
    } catch (error) { this.fail(error); }
  }

  async selectProject(project: Project) {
    if (this.busy) return;
    const token = ++this.projectLoadToken;
    this.project = project;
    this.conversation = null;
    this.selectedFlow = null;
    this.messages = [];
    this.error = '';
    try {
      const [conversations, resources, flows, memories] = await Promise.all([
        this.api.conversations(project.id), this.api.resources(project.id), this.api.flows(project.id), this.api.memories(project.id),
      ]);
      if (token !== this.projectLoadToken) return;
      this.conversations = conversations.conversations;
      this.resources = resources.resources;
      this.flows = flows.flows;
      this.memories = memories.memories;
      if (this.conversations[0]) await this.selectConversation(this.conversations[0]);
      else await this.newConversation();
      if (this.flows[0]) await this.selectFlow(this.flows[0]);
    } catch (error) { this.fail(error); }
    finally { this.render(); }
  }

  async newConversation() {
    if (!this.project || this.creatingConversation) return;
    this.creatingConversation = true;
    try {
      const response = await this.api.createConversation(this.project.id);
      this.conversations = [response.conversation, ...this.conversations.filter(item => item.id !== response.conversation.id)];
      this.page = 'chat';
      await this.selectConversation(response.conversation);
    } catch (error) { this.fail(error); }
    finally { this.creatingConversation = false; this.render(); }
  }

  async selectConversation(conversation: Conversation) {
    if (this.busy) return;
    this.conversation = conversation;
    this.editingConversationTitle = conversation.title;
    try {
      const response = await this.api.messages(conversation.id);
      if (this.conversation?.id === conversation.id) this.messages = response.messages;
    } catch (error) { this.fail(error); }
    finally { this.render(); }
  }

  async renameConversation() {
    const title = this.editingConversationTitle.trim();
    if (!this.conversation || !title || title === this.conversation.title) return;
    try {
      const response = await this.api.renameConversation(this.conversation.id, title);
      this.conversation = response.conversation;
      this.editingConversationTitle = response.conversation.title;
      this.conversations = this.conversations.map(item => item.id === response.conversation.id ? response.conversation : item);
      this.notice = 'Conversa renomeada.';
    } catch (error) { this.fail(error); }
    finally { this.render(); }
  }

  confirmDeleteConversation(conversation: Conversation, event?: Event) {
    event?.stopPropagation();
    this.deleteTarget = { type: 'conversation', id: conversation.id, name: conversation.title };
    this.render();
  }

  confirmDeleteProject(project: Project, event?: Event) {
    event?.stopPropagation();
    this.deleteTarget = { type: 'project', id: project.id, name: project.name };
    this.render();
  }

  async executeDelete() {
    const target = this.deleteTarget;
    if (!target) return;
    this.deleteTarget = null;
    try {
      if (target.type === 'conversation') {
        await this.api.deleteConversation(target.id);
        const wasSelected = this.conversation?.id === target.id;
        this.conversations = this.conversations.filter(item => item.id !== target.id);
        if (wasSelected) {
          this.conversation = null;
          this.messages = [];
          if (this.conversations[0]) await this.selectConversation(this.conversations[0]);
          else await this.newConversation();
        }
        this.notice = 'Conversa excluída.';
      } else {
        await this.api.deleteProject(target.id);
        const wasSelected = this.project?.id === target.id;
        this.projects = this.projects.filter(item => item.id !== target.id);
        if (wasSelected) {
          this.project = null;
          this.conversation = null;
          this.conversations = [];
          this.messages = [];
          this.resources = [];
          this.flows = [];
          this.memories = [];
          this.selectedFlow = null;
          if (this.projects[0]) await this.selectProject(this.projects[0]);
        }
        this.notice = 'Projeto e seus dados locais foram excluídos.';
      }
    } catch (error) { this.fail(error); }
    finally { this.render(); }
  }

  cancelDelete() { this.deleteTarget = null; this.render(); }

  titleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') { event.preventDefault(); void this.renameConversation(); }
  }

  onComposerKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void this.send(); }
  }

  async send() {
    if (!this.input.trim() || !this.conversation || this.busy) return;
    const content = this.input.trim();
    const conversationId = this.conversation.id;
    this.input = '';
    this.messages = [...this.messages, { role: 'user', content }, { role: 'assistant', content: '' }];
    this.busy = true;
    this.generationStatus = 'Conectando ao modelo local…';
    this.error = '';
    try {
      const response = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, model: this.model, enabled_tools: this.enabledTools }),
      });
      if (!response.ok || !response.body) throw new Error(await this.responseError(response));
      await this.refreshConversations(conversationId);
      this.render();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const event of events) this.consumeEvent(event);
      }
      buffer += decoder.decode();
      if (buffer.trim()) this.consumeEvent(buffer);
      await this.refreshConversations(conversationId);
    } catch (error) { this.fail(error); }
    finally {
      this.busy = false;
      this.generationStatus = '';
      if (!this.messages[this.messages.length - 1]?.content && this.messages[this.messages.length - 1]?.role === 'assistant') this.messages = this.messages.slice(0, -1);
      this.render();
    }
  }

  consumeEvent(event: string) {
    const type = event.match(/^event: (.+)$/m)?.[1];
    const raw = event.match(/^data: (.+)$/m)?.[1];
    if (!type || !raw) return;
    const data = JSON.parse(raw) as { content?: string; error?: string; message?: ChatMessage; invocationId?: number; tool?: string; arguments?: Record<string, unknown> };
    if (type === 'run_started') this.generationStatus = 'Modelo local está gerando a resposta…';
    if (type === 'delta') { this.generationStatus = ''; this.messages[this.messages.length - 1].content += data.content ?? ''; }
    if (type === 'completed' && data.message) this.messages[this.messages.length - 1] = data.message;
    if (type === 'failed') this.fail(data.error ?? 'Falha na inferência local.');
    if (type === 'approval_required' && data.invocationId && data.tool && data.arguments) {
      this.messages = this.messages.filter(message => message.content || message.role !== 'assistant');
      this.approval = { id: data.invocationId, tool: data.tool, arguments: data.arguments, created: true };
    }
    this.render();
  }

  async refreshConversations(selectedId?: number) {
    if (!this.project) return;
    const response = await this.api.conversations(this.project.id);
    this.conversations = response.conversations;
    const selected = response.conversations.find(item => item.id === (selectedId ?? this.conversation?.id));
    if (selected) { this.conversation = selected; this.editingConversationTitle = selected.title; }
  }

  async upload(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || !this.project) return;
    try {
      const response = await this.api.upload(this.project.id, file);
      this.resources = [response.resource, ...this.resources];
      this.notice = `${file.name} adicionado ao projeto.`;
    } catch (error) { this.fail(error); }
    finally { this.render(); }
  }

  requestTool() {
    if (!this.project || !this.selectedTool || !this.toolResourceId) { this.error = 'Selecione uma tool e um resource.'; return; }
    const arguments_: Record<string, unknown> = { resource_id: Number(this.toolResourceId) };
    if (this.selectedTool === 'duckdb_query_csv') arguments_['query'] = this.toolQuery;
    this.approval = { id: 0, tool: this.selectedTool, arguments: arguments_, created: false };
  }

  async approveTool() {
    if (!this.project || !this.approval) return;
    const flowRunId = this.approval.flowRunId;
    try {
      const invocationId = this.approval.created ? this.approval.id : (await this.api.invoke(this.project.id, this.conversation?.id ?? null, this.approval.tool, this.approval.arguments)).invocation.id;
      const result = await this.api.approve(invocationId);
      if (!flowRunId) {
        this.messages = [...this.messages, { role: 'tool', content: `Tool ${this.approval.tool} concluída:\n${JSON.stringify(result.invocation.result, null, 2)}` }];
        if (result.assistant) this.messages = [...this.messages, result.assistant];
        this.page = 'chat';
      }
      this.approval = null;
      if (flowRunId) this.pollRun(flowRunId);
    } catch (error) { this.fail(error); }
    finally { this.render(); }
  }

  async declineTool() {
    const flowRunId = this.approval?.flowRunId;
    if (this.approval?.created) {
      try { await this.api.decline(this.approval.id); } catch (error) { this.fail(error); }
    }
    this.approval = null;
    if (flowRunId) this.pollRun(flowRunId);
    this.render();
  }

  toggleAgentTool(name: string) { this.enabledTools = this.toggle(this.enabledTools, name); }

  async createFlow(template: FlowTemplate) {
    if (!this.project) return;
    try {
      const response = await this.api.createFlow(this.project.id, { templateKey: template.key });
      this.flows = [response.flow, ...this.flows];
      await this.selectFlow(response.flow);
      this.notice = 'Fluxo criado a partir do template.';
    } catch (error) { this.fail(error); }
    finally { this.render(); }
  }

  async createBlankFlow() {
    if (!this.project) return;
    const graph: FlowGraph = { nodes: [this.newNode('executor', 120, 160)], edges: [] };
    try {
      const response = await this.api.createFlow(this.project.id, { name: 'Novo fluxo', description: 'Fluxo personalizado', graph });
      this.flows = [response.flow, ...this.flows];
      await this.selectFlow(response.flow);
    } catch (error) { this.fail(error); }
    finally { this.render(); }
  }

  async selectFlow(flow: Flow) {
    try {
      const [detail, versions, runs] = await Promise.all([this.api.flow(flow.id), this.api.flowVersions(flow.id), this.api.flowRuns(flow.id)]);
      this.selectedFlow = detail.flow;
      this.graph = this.copyGraph(detail.flow.graph ?? { nodes: [], edges: [] });
      this.selectedNode = this.graph.nodes[0] ?? null;
      this.flowVersions = versions.versions;
      this.flowRuns = runs.runs;
      this.currentRun = runs.runs[0] ?? null;
    } catch (error) { this.fail(error); }
    finally { this.render(); }
  }

  addNode(type: FlowNode['type']) {
    const node = this.newNode(type, 80 + this.graph.nodes.length * 40, 90 + this.graph.nodes.length * 35);
    this.graph = { ...this.graph, nodes: [...this.graph.nodes, node] };
    this.selectedNode = node;
  }

  removeNode(node: FlowNode) {
    this.graph = { nodes: this.graph.nodes.filter(item => item.id !== node.id), edges: this.graph.edges.filter(edge => edge.source !== node.id && edge.target !== node.id) };
    this.selectedNode = this.graph.nodes[0] ?? null;
  }

  addEdge() {
    if (!this.edgeSource || !this.edgeTarget || this.edgeSource === this.edgeTarget) return;
    if (this.graph.edges.some(edge => edge.source === this.edgeSource && edge.target === this.edgeTarget)) return;
    const edge: FlowEdge = { id: `e-${Date.now()}`, source: this.edgeSource, target: this.edgeTarget };
    this.graph = { ...this.graph, edges: [...this.graph.edges, edge] };
  }

  removeEdge(edge: FlowEdge) { this.graph = { ...this.graph, edges: this.graph.edges.filter(item => item.id !== edge.id) }; }

  onNodeDragStart(event: DragEvent, node: FlowNode) { event.dataTransfer?.setData('text/plain', node.id); }
  onCanvasDragOver(event: DragEvent) { event.preventDefault(); }
  onCanvasDrop(event: DragEvent) {
    event.preventDefault();
    const id = event.dataTransfer?.getData('text/plain');
    const canvas = event.currentTarget as HTMLElement;
    const node = this.graph.nodes.find(item => item.id === id);
    if (!node) return;
    const rect = canvas.getBoundingClientRect();
    node.x = Math.max(12, Math.round(event.clientX - rect.left - 110));
    node.y = Math.max(12, Math.round(event.clientY - rect.top - 35));
    this.graph = { ...this.graph, nodes: [...this.graph.nodes] };
  }

  edgeLine(edge: FlowEdge) {
    const source = this.graph.nodes.find(node => node.id === edge.source);
    const target = this.graph.nodes.find(node => node.id === edge.target);
    return { x1: (source?.x ?? 0) + 220, y1: (source?.y ?? 0) + 55, x2: target?.x ?? 0, y2: (target?.y ?? 0) + 55 };
  }

  toggleNodeTool(name: string) { if (this.selectedNode) this.selectedNode.tools = this.toggle(this.selectedNode.tools, name); }
  toggleNodeMemory(name: string) { if (this.selectedNode) this.selectedNode.memory = this.toggle(this.selectedNode.memory, name); }

  async saveFlow() {
    if (!this.selectedFlow || this.savingFlow) return;
    this.savingFlow = true;
    try {
      await this.api.renameFlow(this.selectedFlow.id, this.selectedFlow.name, this.selectedFlow.description);
      const response = await this.api.saveFlowVersion(this.selectedFlow.id, this.copyGraph(this.graph));
      this.selectedFlow.activeVersion = response.version.version;
      this.flows = this.flows.map(item => item.id === this.selectedFlow?.id ? { ...item, name: this.selectedFlow!.name, activeVersion: response.version.version } : item);
      this.flowVersions = (await this.api.flowVersions(this.selectedFlow.id)).versions;
      this.notice = `Versão ${response.version.version} salva.`;
    } catch (error) { this.fail(error); }
    finally { this.savingFlow = false; this.render(); }
  }

  async restoreVersion(version: {version: number; graph: FlowGraph}) {
    this.graph = this.copyGraph(version.graph);
    this.selectedNode = this.graph.nodes[0] ?? null;
    this.notice = `Versão ${version.version} carregada no editor. Salve para criar uma nova versão.`;
  }

  async runFlow() {
    if (!this.selectedFlow || !this.flowTask.trim()) return;
    try {
      const response = await this.api.startFlow(this.selectedFlow.id, this.flowTask.trim(), this.conversation?.id ?? null);
      this.currentRun = response.run;
      this.flowRuns = [response.run, ...this.flowRuns];
      this.pollRun(response.run.id);
    } catch (error) { this.fail(error); }
    finally { this.render(); }
  }

  private pollRun(runId: number) {
    if (this.runPoll) clearTimeout(this.runPoll);
    this.runPoll = setTimeout(async () => {
      try {
        const response = await this.api.flowRun(runId);
        this.currentRun = response.run;
        this.flowRuns = this.flowRuns.map(item => item.id === runId ? response.run : item);
        if (response.run.status === 'awaiting_approval' && response.run.pendingApproval) {
          const pending = response.run.pendingApproval;
          this.approval = { id: pending.id, tool: pending.tool, arguments: pending.arguments, created: true, flowRunId: runId };
        } else if (['queued', 'running'].includes(response.run.status)) this.pollRun(runId);
        else if (response.run.status === 'completed') {
          this.notice = 'Execução multiagente concluída.';
          if (this.conversation) { await this.refreshConversations(this.conversation.id); await this.selectConversation(this.conversation); }
          if (this.project) this.memories = (await this.api.memories(this.project.id)).memories;
        } else if (response.run.error) this.error = response.run.error;
      } catch (error) { this.fail(error); }
      finally { this.render(); }
    }, 900);
  }

  async addMemory() {
    if (!this.project || !this.memoryContent.trim()) return;
    this.memoryBusy = true;
    try {
      const response = await this.api.createMemory(this.project.id, this.memoryKind, this.memoryContent.trim(), this.conversation?.id);
      this.memories = [response.memory, ...this.memories];
      this.memoryContent = '';
      this.notice = 'Memória persistida localmente.';
    } catch (error) { this.fail(error); }
    finally { this.memoryBusy = false; this.render(); }
  }

  async removeMemory(memory: MemoryEntry) {
    try { await this.api.deleteMemory(memory.id); this.memories = this.memories.filter(item => item.id !== memory.id); }
    catch (error) { this.fail(error); }
    finally { this.render(); }
  }

  async searchMemory() {
    if (!this.project || !this.memoryQuery.trim()) return;
    this.memoryBusy = true;
    try { this.searchResults = (await this.api.search(this.project.id, this.memoryQuery.trim())).results; }
    catch (error) { this.fail(error); }
    finally { this.memoryBusy = false; this.render(); }
  }

  trackId(_: number, item: {id: number | string}) { return item.id; }
  private toggle(values: string[], value: string) { return values.includes(value) ? values.filter(item => item !== value) : [...values, value]; }
  private newNode(type: FlowNode['type'], x: number, y: number): FlowNode {
    const id = `${type}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const names = { planner: 'Planejador', executor: 'Executor', reviewer: 'Revisor', router: 'Roteador' };
    return { id, type, name: names[type], x, y, model: this.model, prompt: '', tools: [], memory: ['short_term'] };
  }
  private copyGraph(graph: FlowGraph): FlowGraph { return JSON.parse(JSON.stringify(graph)) as FlowGraph; }
  private render() { this.changeDetector.detectChanges(); }
  private fail(error: unknown) { this.error = error instanceof Error ? error.message : String(error); this.generationStatus = ''; }
  private async responseError(response: Response) { const text = await response.text(); try { return JSON.parse(text).error ?? text; } catch { return text || 'Falha na requisição.'; } }
}
