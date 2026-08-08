import { App, Notice, requestUrl, TFile } from "obsidian";
import { TasksMapSettings } from "../types/settings";
import { t } from "../i18n";

export type TaskOrganizerAiProvider = "openai" | "anthropic" | "google";
export type TaskOrganizerOrphans = "skip" | "unassigned";
export type TaskOrganizerNoteKind = "task" | "project" | "attachment-note";
export type TaskOrganizerMoveKind = "note" | "attachment";
export type TaskOrganizerSlugSource = "llm" | "fallback" | "manual";

export interface TaskOrganizerMove {
  kind: TaskOrganizerMoveKind;
  from: string;
  to: string;
  reason: string;
  projectFolder: string;
}

export interface TaskOrganizerMetadataUpdate {
  path: string;
  fields: {
    folder_slug: string;
    folder_slug_source: TaskOrganizerSlugSource;
    folder_schema: typeof TASK_FOLDER_SCHEMA;
  };
}

export interface TaskOrganizerPlan {
  noteMoves: TaskOrganizerMove[];
  attachmentMoves: TaskOrganizerMove[];
  metadataUpdates: TaskOrganizerMetadataUpdate[];
  warnings: string[];
  skippedOrphans: string[];
  skippedSharedAttachments: string[];
  alreadyOrganized: number;
}

export interface TaskOrganizerExecutionResult {
  succeeded: number;
  failed: number;
  errors: string[];
}

export interface TaskOrganizerPlannerNote {
  path: string;
  basename: string;
  extension: string;
  kind: TaskOrganizerNoteKind;
  frontmatter: Record<string, unknown>;
  links: AttachmentLink[];
  embeds: AttachmentLink[];
}

interface AttachmentLink {
  link: string;
}

interface AttachmentRef {
  path: string;
  ownerTaskPath: string;
}

interface JsonResponse {
  ok: boolean;
  status: number;
  json: Record<string, unknown>;
}

interface TaskDestinationCandidate {
  task: TaskOrganizerPlannerNote;
  projectFolder: string;
}

export interface TaskOrganizerPlanProgress {
  phase: "ai-folder-names";
  completed: number;
  total: number;
  currentPath?: string;
}

export interface TaskOrganizerPlanInput {
  notes: TaskOrganizerPlannerNote[];
  existingPaths: Set<string>;
  resolveLink: (_sourcePath: string, _rawLink: string) => string | null;
  settings: Pick<
    TasksMapSettings,
    | "taskOrganizerRenameProjectFolders"
    | "taskOrganizerRenameTaskFolders"
    | "taskOrganizerUseAiFolderNames"
    | "taskOrganizerAiProvider"
    | "taskOrganizerAiModel"
    | "taskOrganizerAiApiKey"
    | "taskOrganizerOrphans"
    | "taskOrganizerExcludedFolders"
  >;
  fetchImpl?: typeof fetch;
  onProgress?: (progress: TaskOrganizerPlanProgress) => void;
}

export const TASK_FOLDER_SCHEMA = "task-folder-v1";
const AI_SLUG_CONCURRENCY = 4;
const AI_REQUEST_TIMEOUT_MS = 15_000;

const OWNED_ATTACHMENT_NOTE_TYPES = new Set([
  "task-card",
  "prompt-note",
  "copilot-conversation",
]);

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index);
}

function basename(path: string, extension = ""): string {
  const name = normalizePath(path).split("/").pop() ?? path;
  return extension && name.endsWith(extension)
    ? name.slice(0, -extension.length)
    : name;
}

function pathSegments(path: string): string[] {
  return normalizePath(path).split("/").filter(Boolean);
}

function parseExcludedFolders(rawFolders: string): string[] {
  return rawFolders
    .split(/[\n,]/)
    .map((folder) => normalizePath(folder.trim()).replace(/\/+$/g, ""))
    .filter(Boolean);
}

function isPathInFolder(path: string, folder: string): boolean {
  const normalizedPath = normalizePath(path).toLowerCase();
  const normalizedFolder = normalizePath(folder).toLowerCase();
  return (
    normalizedPath === normalizedFolder ||
    normalizedPath.startsWith(`${normalizedFolder}/`)
  );
}

function isExcludedPath(
  path: string,
  settings: TaskOrganizerPlanInput["settings"]
): boolean {
  return parseExcludedFolders(settings.taskOrganizerExcludedFolders).some(
    (folder) => isPathInFolder(path, folder)
  );
}

function extensionOf(path: string): string {
  const name = basename(path);
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index + 1).toLowerCase();
}

function titleForNote(note: TaskOrganizerPlannerNote): string {
  const title = note.frontmatter.title;
  return typeof title === "string" && title.trim()
    ? title.trim()
    : note.basename;
}

function fallbackSlug(title: string): string {
  const words =
    title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? [];
  const slug = words.length === 0 ? "untitled" : words.slice(0, 4).join("-");
  return avoidReservedName(slug.slice(0, 48).replace(/-+$/g, "") || "untitled");
}

function normalizeSlug(value: string, maxLength = 48): string | null {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return cleaned ? avoidReservedName(cleaned) : null;
}

function normalizeAiSlug(value: string): string | null {
  const cleaned = value
    .trim()
    .replace(/^```[a-z]*\s*|\s*```$/gi, "")
    .replace(/^['"`]+|['"`]+$/g, "");
  const slug = normalizeSlug(cleaned, 48);
  if (!slug) return null;
  const words = slug.split("-").filter(Boolean);
  return words.length >= 2 && words.length <= 4 ? slug : null;
}

function avoidReservedName(slug: string): string {
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(slug)
    ? `${slug}-note`
    : slug;
}

function uniqueSlug(base: string, reserved: Set<string>): string {
  if (!reserved.has(base)) {
    reserved.add(base);
    return base;
  }

  let index = 2;
  while (reserved.has(withSuffix(base, index))) {
    index++;
  }
  const unique = withSuffix(base, index);
  reserved.add(unique);
  return unique;
}

function uniqueSlugWithWarning(
  base: string,
  reserved: Set<string>,
  warnings: string[],
  path: string
): string {
  const slug = uniqueSlug(base, reserved);
  if (slug !== base) {
    warnings.push(`${path}: folder name collision, using ${slug}.`);
  }
  return slug;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex++;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return results;
}

function withSuffix(base: string, index: number): string {
  const suffix = `-${index}`;
  return `${base.slice(0, 48 - suffix.length).replace(/-+$/g, "")}${suffix}`;
}

function frontmatterList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return typeof value === "string" ? [value] : [];
}

function projectLinks(note: TaskOrganizerPlannerNote): string[] {
  return frontmatterList(note.frontmatter.projects).filter(
    (entry) => entry.trim().length > 0
  );
}

function isManagedAttachmentNote(
  note: TaskOrganizerPlannerNote | undefined
): boolean {
  const type = note?.frontmatter.type;
  return typeof type === "string" && OWNED_ATTACHMENT_NOTE_TYPES.has(type);
}

function resolveOwningProject(
  taskPath: string,
  taskToParent: Map<string, string>,
  taskToDirectProject: Map<string, string>,
  visited = new Set<string>()
): string | null {
  if (visited.has(taskPath)) return null;
  visited.add(taskPath);

  const directProject = taskToDirectProject.get(taskPath);
  if (directProject) return directProject;

  const parent = taskToParent.get(taskPath);
  return parent
    ? resolveOwningProject(parent, taskToParent, taskToDirectProject, visited)
    : null;
}

function currentProjectFolderName(
  note: TaskOrganizerPlannerNote
): string | null {
  const segments = pathSegments(note.path);
  if (segments[0] !== "projects" || segments.length < 3) return null;
  return normalizeSlug(segments[1]);
}

function currentTaskFolderName(note: TaskOrganizerPlannerNote): string | null {
  const segments = pathSegments(note.path);
  if (segments[0] !== "projects" || segments.length < 4) return null;
  return normalizeSlug(segments[segments.length - 2]);
}

function readSlugSource(value: unknown): TaskOrganizerSlugSource {
  return value === "llm" || value === "fallback" || value === "manual"
    ? value
    : "manual";
}

function hasUsableStoredSlug(note: TaskOrganizerPlannerNote): boolean {
  const stored = note.frontmatter.folder_slug;
  return typeof stored === "string" && normalizeSlug(stored) !== null;
}

function taskNeedsAiSlug(
  note: TaskOrganizerPlannerNote,
  settings: TaskOrganizerPlanInput["settings"]
): boolean {
  return (
    settings.taskOrganizerRenameTaskFolders &&
    settings.taskOrganizerUseAiFolderNames &&
    settings.taskOrganizerAiModel.trim().length > 0 &&
    settings.taskOrganizerAiApiKey.trim().length > 0 &&
    !hasUsableStoredSlug(note) &&
    !(
      note.frontmatter.folder_schema === TASK_FOLDER_SCHEMA &&
      currentTaskFolderName(note)
    )
  );
}

function resolveProjectSlug(
  note: TaskOrganizerPlannerNote,
  settings: TaskOrganizerPlanInput["settings"]
): string {
  if (!settings.taskOrganizerRenameProjectFolders) {
    const current = currentProjectFolderName(note);
    if (current) return current;
  }
  return fallbackSlug(titleForNote(note));
}

async function generateTaskSlug(
  note: TaskOrganizerPlannerNote,
  settings: TaskOrganizerPlanInput["settings"],
  fetchImpl?: typeof fetch
): Promise<{
  slug: string;
  source: TaskOrganizerSlugSource;
  warning?: string;
}> {
  const stored = note.frontmatter.folder_slug;
  if (typeof stored === "string") {
    const normalized = normalizeSlug(stored);
    if (normalized) {
      return {
        slug: normalized,
        source: readSlugSource(note.frontmatter.folder_slug_source),
      };
    }
  }

  const title = titleForNote(note);
  if (
    !settings.taskOrganizerUseAiFolderNames ||
    !settings.taskOrganizerAiModel.trim() ||
    !settings.taskOrganizerAiApiKey.trim()
  ) {
    return { slug: fallbackSlug(title), source: "fallback" };
  }

  try {
    const raw = await requestSemanticSlug(
      {
        provider: settings.taskOrganizerAiProvider,
        model: settings.taskOrganizerAiModel.trim(),
        apiKey: settings.taskOrganizerAiApiKey.trim(),
        title,
      },
      fetchImpl
    );
    const slug = normalizeAiSlug(raw);
    if (!slug) throw new Error("Provider returned an invalid folder name.");
    return { slug, source: "llm" };
  } catch (error) {
    return {
      slug: fallbackSlug(title),
      source: "fallback",
      warning: `${note.path}: ${(error as Error).message}`,
    };
  }
}

async function resolveTaskSlug(
  note: TaskOrganizerPlannerNote,
  settings: TaskOrganizerPlanInput["settings"],
  fetchImpl?: typeof fetch
): Promise<{
  slug: string;
  source: TaskOrganizerSlugSource;
  shouldPersist: boolean;
  warning?: string;
}> {
  if (!settings.taskOrganizerRenameTaskFolders) {
    const current = currentTaskFolderName(note);
    if (current) {
      return { slug: current, source: "manual", shouldPersist: false };
    }
    return {
      slug: fallbackSlug(titleForNote(note)),
      source: "fallback",
      shouldPersist: true,
    };
  }

  if (note.frontmatter.folder_schema === TASK_FOLDER_SCHEMA) {
    const current = currentTaskFolderName(note);
    if (current) {
      return {
        slug: current,
        source: readSlugSource(note.frontmatter.folder_slug_source),
        shouldPersist: true,
      };
    }
  }

  const generated = await generateTaskSlug(note, settings, fetchImpl);
  return { ...generated, shouldPersist: true };
}

async function requestSemanticSlug(
  settings: {
    provider: TaskOrganizerAiProvider;
    model: string;
    apiKey: string;
    title: string;
  },
  fetchImpl?: typeof fetch
): Promise<string> {
  const prompt = [
    "Return only a lowercase ASCII kebab-case folder name.",
    "Use 2-4 distinguishing words.",
    "Keep meaningful technical terms; omit filler words. Do not explain.",
    `Title: ${settings.title}`,
  ].join("\n");
  const controller = new AbortController();
  const timer = globalThis.setTimeout(
    () => controller.abort(),
    AI_REQUEST_TIMEOUT_MS
  );

  try {
    if (settings.provider === "openai") {
      const response = await postJson(
        "https://api.openai.com/v1/responses",
        {
          Authorization: `Bearer ${settings.apiKey}`,
        },
        {
          model: settings.model,
          input: prompt,
          reasoning: { effort: "none" },
          max_output_tokens: 40,
          store: false,
        },
        fetchImpl,
        controller.signal
      );
      ensureOk(response);
      return readOpenAIText(response.json);
    }

    if (settings.provider === "anthropic") {
      const response = await postJson(
        "https://api.anthropic.com/v1/messages",
        {
          "x-api-key": settings.apiKey,
          "anthropic-version": "2023-06-01",
        },
        {
          model: settings.model,
          max_tokens: 40,
          messages: [{ role: "user", content: prompt }],
        },
        fetchImpl,
        controller.signal
      );
      ensureOk(response);
      const content = Array.isArray(response.json.content)
        ? response.json.content
        : [];
      return content
        .filter(
          (item: unknown): item is { type: string; text?: string } =>
            typeof item === "object" &&
            item !== null &&
            "type" in item &&
            item.type === "text"
        )
        .map((item) => item.text ?? "")
        .join("");
    }

    const response = await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        settings.model
      )}:generateContent`,
      {
        "x-goog-api-key": settings.apiKey,
      },
      {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      },
      fetchImpl,
      controller.signal
    );
    ensureOk(response);
    return readGoogleText(response.json);
  } finally {
    globalThis.clearTimeout(timer);
  }
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch | undefined,
  signal: AbortSignal
): Promise<JsonResponse> {
  if (fetchImpl) {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
    try {
      return {
        ok: response.ok,
        status: response.status,
        json: (await response.json()) as Record<string, unknown>,
      };
    } catch {
      throw new Error(
        `Provider returned non-JSON response (HTTP ${response.status}).`
      );
    }
  }

  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = globalThis.setTimeout(
      () => reject(new Error("Provider request timed out.")),
      AI_REQUEST_TIMEOUT_MS
    );
  });
  const response = await Promise.race([
    requestUrl({
      url,
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      throw: false,
    }),
    timeout,
  ]).finally(() => {
    if (timeoutId) globalThis.clearTimeout(timeoutId);
  });
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    json:
      typeof response.json === "object" && response.json !== null
        ? (response.json as Record<string, unknown>)
        : {},
  };
}

function ensureOk(response: JsonResponse): void {
  if (response.ok) return;
  const error = response.json.error;
  const message =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message
      : typeof response.json.message === "string"
        ? response.json.message
        : `HTTP ${response.status}`;
  throw new Error(`Provider request failed: ${message.slice(0, 300)}`);
}

function readOpenAIText(json: Record<string, unknown>): string {
  if (typeof json.output_text === "string") return json.output_text;
  const output = Array.isArray(json.output) ? json.output : [];
  return output
    .flatMap((item) =>
      typeof item === "object" &&
      item !== null &&
      "content" in item &&
      Array.isArray(item.content)
        ? item.content
        : []
    )
    .filter(
      (item: unknown): item is { type: string; text?: string } =>
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        item.type === "output_text"
    )
    .map((item) => item.text ?? "")
    .join("");
}

function readGoogleText(json: Record<string, unknown>): string {
  const candidates = Array.isArray(json.candidates) ? json.candidates : [];
  return candidates
    .flatMap((candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      "content" in candidate &&
      typeof candidate.content === "object" &&
      candidate.content !== null &&
      "parts" in candidate.content &&
      Array.isArray(candidate.content.parts)
        ? candidate.content.parts
        : []
    )
    .filter(
      (part: unknown): part is { text?: string } =>
        typeof part === "object" && part !== null
    )
    .map((part) => part.text ?? "")
    .join("");
}

function metadataNeedsUpdate(
  note: TaskOrganizerPlannerNote,
  slug: string,
  source: TaskOrganizerSlugSource
): boolean {
  return (
    note.frontmatter.folder_slug !== slug ||
    note.frontmatter.folder_slug_source !== source ||
    note.frontmatter.folder_schema !== TASK_FOLDER_SCHEMA
  );
}

export async function buildTaskOrganizerPlanFromInput(
  input: TaskOrganizerPlanInput
): Promise<TaskOrganizerPlan> {
  const warnings: string[] = [];
  const skippedOrphans: string[] = [];
  const noteMoves: TaskOrganizerMove[] = [];
  const attachmentMoves: TaskOrganizerMove[] = [];
  const metadataUpdates: TaskOrganizerMetadataUpdate[] = [];
  let alreadyOrganized = 0;

  const notes = input.notes.filter(
    (note) => !isExcludedPath(note.path, input.settings)
  );
  const notesByPath = new Map(notes.map((note) => [note.path, note]));
  const projects = notes.filter((note) => note.kind === "project");
  const tasks = notes.filter((note) => note.kind === "task");

  const taskToParent = new Map<string, string>();
  const taskToDirectProject = new Map<string, string>();

  for (const task of tasks) {
    for (const raw of projectLinks(task)) {
      const resolved = input.resolveLink(task.path, raw);
      if (!resolved) continue;
      const target = notesByPath.get(resolved);
      if (!target || target.kind === "attachment-note") continue;
      if (target.kind === "project" && !taskToDirectProject.has(task.path)) {
        taskToDirectProject.set(task.path, target.path);
      } else if (target.kind === "task" && !taskToParent.has(task.path)) {
        taskToParent.set(task.path, target.path);
      }
    }
  }

  const projectFolderByPath = new Map<string, string>();
  const projectReserved = new Set<string>();
  for (const project of projects) {
    const slug = uniqueSlugWithWarning(
      resolveProjectSlug(project, input.settings),
      projectReserved,
      warnings,
      project.path
    );
    projectFolderByPath.set(project.path, `projects/${slug}`);
  }

  const desiredPaths = new Map<string, string>();

  for (const project of projects) {
    const projectFolder = projectFolderByPath.get(project.path);
    if (!projectFolder) continue;
    desiredPaths.set(
      project.path,
      `${projectFolder}/${basename(project.path)}`
    );
  }

  const taskCandidates: TaskDestinationCandidate[] = [];
  for (const task of tasks) {
    const projectPath = resolveOwningProject(
      task.path,
      taskToParent,
      taskToDirectProject
    );

    let projectFolder: string | undefined;
    if (projectPath) {
      projectFolder = projectFolderByPath.get(projectPath);
    } else if (input.settings.taskOrganizerOrphans === "unassigned") {
      projectFolder = "projects/_unassigned";
    } else {
      skippedOrphans.push(task.path);
      continue;
    }

    if (!projectFolder) {
      warnings.push(`${task.path}: linked project could not be organized.`);
      continue;
    }

    taskCandidates.push({ task, projectFolder });
  }

  const aiSlugTotal = taskCandidates.filter(({ task }) =>
    taskNeedsAiSlug(task, input.settings)
  ).length;
  let aiSlugCompleted = 0;
  if (aiSlugTotal > 0) {
    input.onProgress?.({
      phase: "ai-folder-names",
      completed: aiSlugCompleted,
      total: aiSlugTotal,
    });
  }

  const generatedSlugs = await mapWithConcurrency(
    taskCandidates,
    AI_SLUG_CONCURRENCY,
    async ({ task }) => {
      const reportProgress = taskNeedsAiSlug(task, input.settings);
      const result = await resolveTaskSlug(
        task,
        input.settings,
        input.fetchImpl
      );
      if (reportProgress) {
        aiSlugCompleted++;
        input.onProgress?.({
          phase: "ai-folder-names",
          completed: aiSlugCompleted,
          total: aiSlugTotal,
          currentPath: task.path,
        });
      }
      return result;
    }
  );

  const taskFolderReservedByProject = new Map<string, Set<string>>();
  taskCandidates.forEach(({ task, projectFolder }, index) => {
    const reserved =
      taskFolderReservedByProject.get(projectFolder) ?? new Set<string>();
    taskFolderReservedByProject.set(projectFolder, reserved);

    const generated = generatedSlugs[index];
    if (generated.warning) warnings.push(generated.warning);

    const slug = uniqueSlugWithWarning(
      generated.slug,
      reserved,
      warnings,
      task.path
    );
    if (
      generated.shouldPersist &&
      metadataNeedsUpdate(task, slug, generated.source)
    ) {
      metadataUpdates.push({
        path: task.path,
        fields: {
          folder_slug: slug,
          folder_slug_source: generated.source,
          folder_schema: TASK_FOLDER_SCHEMA,
        },
      });
    }

    desiredPaths.set(
      task.path,
      `${projectFolder}/${slug}/${basename(task.path)}`
    );
  });

  const occupiedTargets = new Set<string>();
  for (const [from, to] of desiredPaths) {
    if (from === to) {
      alreadyOrganized++;
      continue;
    }

    if (
      occupiedTargets.has(to) ||
      (input.existingPaths.has(to) && !desiredPaths.has(to))
    ) {
      warnings.push(`${from}: target already exists at ${to}.`);
      continue;
    }
    occupiedTargets.add(to);

    const note = notesByPath.get(from);
    noteMoves.push({
      kind: "note",
      from,
      to,
      reason: note?.kind === "project" ? "project folder" : "task folder",
      projectFolder: to.split("/").slice(0, 2).join("/"),
    });
  }

  const attachmentRefs = collectAttachmentRefs(notes, notesByPath, input);
  const skippedSharedAttachments: string[] = [];
  const plannedAttachmentTargets = new Map<string, string>();

  for (const [attachmentPath, refs] of attachmentRefs) {
    const uniqueOwners = [...new Set(refs.map((ref) => ref.ownerTaskPath))];
    if (uniqueOwners.length !== 1) {
      skippedSharedAttachments.push(attachmentPath);
      warnings.push(`${attachmentPath}: shared attachments are not moved.`);
      continue;
    }

    const ownerTaskPath = uniqueOwners[0];
    const ownerDesired = desiredPaths.get(ownerTaskPath);
    if (!ownerDesired) continue;

    const to = `${dirname(ownerDesired)}/assets/${basename(attachmentPath)}`;
    if (attachmentPath === to) continue;
    if (
      plannedAttachmentTargets.has(to) ||
      (input.existingPaths.has(to) && !attachmentRefs.has(to))
    ) {
      warnings.push(
        `${attachmentPath}: attachment target already exists at ${to}.`
      );
      continue;
    }
    plannedAttachmentTargets.set(to, attachmentPath);

    attachmentMoves.push({
      kind: "attachment",
      from: attachmentPath,
      to,
      reason: `attachment for ${basename(ownerTaskPath, ".md")}`,
      projectFolder: ownerDesired.split("/").slice(0, 2).join("/"),
    });
  }

  return {
    noteMoves,
    attachmentMoves,
    metadataUpdates,
    warnings,
    skippedOrphans,
    skippedSharedAttachments,
    alreadyOrganized,
  };
}

function collectAttachmentRefs(
  notes: TaskOrganizerPlannerNote[],
  notesByPath: Map<string, TaskOrganizerPlannerNote>,
  input: TaskOrganizerPlanInput
): Map<string, AttachmentRef[]> {
  const refsByAttachment = new Map<string, AttachmentRef[]>();

  for (const note of notes) {
    if (note.kind !== "task") continue;
    const links = [...note.links, ...note.embeds];
    for (const link of links) {
      const resolved = input.resolveLink(note.path, link.link);
      if (!resolved || resolved === note.path) continue;
      if (isExcludedPath(resolved, input.settings)) continue;

      const resolvedNote = notesByPath.get(resolved);
      if (resolvedNote?.kind === "task" || resolvedNote?.kind === "project") {
        continue;
      }
      if (
        extensionOf(resolved) === "md" &&
        !isManagedAttachmentNote(resolvedNote)
      ) {
        continue;
      }

      const refs = refsByAttachment.get(resolved) ?? [];
      refs.push({ path: resolved, ownerTaskPath: note.path });
      refsByAttachment.set(resolved, refs);
    }
  }

  return refsByAttachment;
}

function noteMatchesValue(
  frontmatter: Record<string, unknown>,
  propertyName: string,
  expected: string
): boolean {
  const normalizedExpected = expected.replace(/^#/, "").toLowerCase();
  return frontmatterList(frontmatter[propertyName]).some(
    (entry) => entry.replace(/^#/, "").toLowerCase() === normalizedExpected
  );
}

function noteMatchesAnyConfiguredValue(
  frontmatter: Record<string, unknown>,
  propertyName: string,
  rawValues: string
): boolean {
  return rawValues
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .some((value) => noteMatchesValue(frontmatter, propertyName, value));
}

function classifyNote(
  frontmatter: Record<string, unknown>,
  settings: Pick<
    TasksMapSettings,
    "noteTaskPropertyName" | "noteTaskPropertyValue"
  >
): TaskOrganizerNoteKind | null {
  const type = frontmatter.type;
  if (
    type === "project" ||
    noteMatchesValue(frontmatter, settings.noteTaskPropertyName, "project")
  ) {
    return "project";
  }
  if (
    type === "task" ||
    noteMatchesAnyConfiguredValue(
      frontmatter,
      settings.noteTaskPropertyName,
      settings.noteTaskPropertyValue
    )
  ) {
    return "task";
  }
  return null;
}

function getPlannerNotes(
  app: App,
  settings: TasksMapSettings
): TaskOrganizerPlannerNote[] {
  return app.vault.getMarkdownFiles().flatMap((file) => {
    const cache = app.metadataCache.getFileCache(file);
    const frontmatter =
      cache?.frontmatter && typeof cache.frontmatter === "object"
        ? (cache.frontmatter as Record<string, unknown>)
        : {};
    const kind = classifyNote(frontmatter, settings);
    if (
      !kind &&
      !isManagedAttachmentNote({
        path: file.path,
        basename: file.basename,
        extension: file.extension,
        kind: "attachment-note",
        frontmatter,
        links: [],
        embeds: [],
      })
    ) {
      return [];
    }
    return [
      {
        path: normalizePath(file.path),
        basename: file.basename,
        extension: file.extension,
        kind: kind ?? "attachment-note",
        frontmatter,
        links: cache?.links ?? [],
        embeds: cache?.embeds ?? [],
      },
    ];
  });
}

function getExistingPaths(app: App): Set<string> {
  const paths = new Set<string>();
  app.vault
    .getMarkdownFiles()
    .forEach((file) => paths.add(normalizePath(file.path)));

  const resolvedLinks = app.metadataCache.resolvedLinks ?? {};
  Object.values(resolvedLinks).forEach((targets) => {
    Object.keys(targets).forEach((path) => paths.add(normalizePath(path)));
  });

  return paths;
}

function extractLinkTarget(rawLink: string): string {
  const trimmed = rawLink.trim();
  const wiki = trimmed.match(/^!?\[\[([\s\S]+)\]\]$/);
  const inner = wiki ? wiki[1] : trimmed;
  return inner.split("|")[0].split("#")[0].trim();
}

function resolveLink(
  app: App,
  sourcePath: string,
  rawLink: string
): string | null {
  const target = extractLinkTarget(rawLink);
  if (!target) return null;

  const linked = app.metadataCache.getFirstLinkpathDest(target, sourcePath);
  if (linked) return normalizePath(linked.path);

  const direct =
    app.vault.getAbstractFileByPath(target) ??
    app.vault.getAbstractFileByPath(`${target}.md`);
  return direct instanceof TFile ? normalizePath(direct.path) : null;
}

export async function buildTaskOrganizerPlan(
  app: App,
  settings: TasksMapSettings,
  options: {
    onProgress?: (progress: TaskOrganizerPlanProgress) => void;
  } = {}
): Promise<TaskOrganizerPlan> {
  const notes = getPlannerNotes(app, settings);
  return buildTaskOrganizerPlanFromInput({
    notes,
    existingPaths: getExistingPaths(app),
    resolveLink: (sourcePath, rawLink) => resolveLink(app, sourcePath, rawLink),
    settings,
    onProgress: options.onProgress,
  });
}

async function ensureFolder(app: App, folder: string): Promise<void> {
  const normalized = normalizePath(folder);
  if (!normalized) return;
  try {
    await app.vault.adapter.mkdir(normalized);
  } catch {
    // Existing folders throw on some adapters.
  }
}

async function applyMetadataUpdate(
  app: App,
  update: TaskOrganizerMetadataUpdate
): Promise<void> {
  const file = app.vault.getFileByPath(update.path);
  if (!file) throw new Error(`Missing task note: ${update.path}`);
  await app.fileManager.processFrontMatter(file, (frontmatter) => {
    frontmatter.folder_slug = update.fields.folder_slug;
    frontmatter.folder_slug_source = update.fields.folder_slug_source;
    frontmatter.folder_schema = update.fields.folder_schema;
  });
}

async function renamePath(app: App, move: TaskOrganizerMove): Promise<void> {
  const file = app.vault.getAbstractFileByPath(move.from);
  if (!file) {
    throw new Error(`Missing file: ${move.from}`);
  }
  await ensureFolder(app, dirname(move.to));
  await app.fileManager.renameFile(file, move.to);
}

async function pruneEmptyFolders(
  app: App,
  sourcePaths: string[]
): Promise<void> {
  const candidates = [
    ...new Set(sourcePaths.map(dirname).filter(Boolean)),
  ].sort((a, b) => b.split("/").length - a.split("/").length);

  for (const candidate of candidates) {
    let current = candidate;
    while (current && current !== "projects") {
      try {
        const listed = await app.vault.adapter.list(current);
        if (listed.files.length > 0 || listed.folders.length > 0) break;
        await app.vault.adapter.rmdir(current, false);
      } catch {
        break;
      }
      current = dirname(current);
    }
  }
}

export async function executeTaskOrganizerPlan(
  app: App,
  plan: TaskOrganizerPlan
): Promise<TaskOrganizerExecutionResult> {
  let succeeded = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const update of plan.metadataUpdates) {
    try {
      await applyMetadataUpdate(app, update);
      succeeded++;
    } catch (error) {
      failed++;
      errors.push(`${update.path}: ${(error as Error).message}`);
    }
  }

  for (const move of [...plan.noteMoves, ...plan.attachmentMoves]) {
    try {
      await renamePath(app, move);
      succeeded++;
    } catch (error) {
      failed++;
      errors.push(`${move.from}: ${(error as Error).message}`);
    }
  }

  await pruneEmptyFolders(app, [
    ...plan.noteMoves.map((move) => move.from),
    ...plan.attachmentMoves.map((move) => move.from),
  ]);

  globalThis.dispatchEvent?.(new Event("tasks-map:settings-changed"));
  if (failed === 0) {
    new Notice(t("organizer.notice_complete", { count: succeeded }));
  } else {
    console.error("Task organizer failed moves:", errors);
    new Notice(t("organizer.notice_partial", { succeeded, failed }), 8000);
  }

  return { succeeded, failed, errors };
}
