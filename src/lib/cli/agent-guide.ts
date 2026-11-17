/**
 * The guide AI agents read with `obsidian <plugin-id>:skill`. It ships with
 * the plugin so the instructions always match the installed commands.
 */
export function buildAgentGuide(prefix: string): string {
  const cmd = (action: string) => `obsidian ${prefix}:${action}`;
  return `# Tasks Map CLI — guide for AI agents

Tasks Map shows the vault's task notes as a map. These commands read and
change the same tasks the user sees, using the same task detection, parent
property and statuses as the map. Obsidian must be running. On Windows the
binary is \`Obsidian.com\` if \`obsidian\` is not on PATH. Add
\`vault=<name>\` to target a specific vault.

## Start of a session

1. \`${cmd("schema")}\` — statuses, priorities and the parent property.
2. \`${cmd("tree")} task="<project>"\` — the project as the user sees it.

## Finding tasks

- \`${cmd("resolve")} query="<words>"\` — exact paths and wikilinks.
- \`${cmd("show")} task="<path or title>"\` — fields, parents, children.
- \`${cmd("list")}\` — open tasks (the map's default statuses).
  Filters: \`status=\`, \`all\`, \`within="<project>"\`, \`tag=\`, \`search=\`,
  \`overdue\`, \`due-before=YYYY-MM-DD\`, \`projects\`, \`limit=\`, \`format=json\`.
- \`${cmd("tree")}\` — text tree; \`all\` includes finished tasks, \`paths\`
  adds file paths.

Any \`task=\` value may be a path, a wikilink or a title. If several tasks
match equally well the command fails and lists the paths; retry with a path.
Never write a wikilink you have not seen in \`resolve\` or \`show\` output.

## Changing tasks

- Create: \`${cmd("create")} title="<title>" parent="<project>" status=<status>
  priority=<id> due=YYYY-MM-DD scheduled=YYYY-MM-DD tags=a,b contexts=x,y
  log="<context>"\`.
  TaskNotes names the file; the note gets a \`## Log\` section whose first
  entry is \`### <today> — Created\` followed by \`log\`.
- Update: \`${cmd("update")} task="<task>" status=<status> priority=<id>
  due=<date> scheduled=<date>\` (or \`clear-due\`, \`clear-scheduled\`).
- Log progress: \`${cmd("log")} task="<task>" text="<what happened>"
  title="<short heading>"\`. Entries are appended as \`### <date> — <title>\`
  under \`## Log\`; existing entries are never edited. Use \`\\n\` for new lines.
- Re-parent: \`${cmd("link")} task="<child>" parent="<parent>"\` (add
  \`remove\` to unlink). Cycles are refused.
- Show the user: \`${cmd("focus")} task="<task>"\` (\`overview\` for the whole
  project, \`newtab\`, \`layout=tree\`, \`direction=vertical\`).

Statuses accept the id, label or note value from \`schema\`. Completing a
task is \`update status=done\` (or the vault's equivalent from \`schema\`).

## Rules

- Read before writing: \`show\` the task first when unsure which one it is.
- Do not invent motivation, goals or results; log only what the user said or
  what you verifiably did.
- For notes that are not tasks (meeting notes, experiment logs, cards), use
  Obsidian's own \`create\`, \`read\`, \`append\` and \`property:set\` commands.
- Time tracking lives in TaskNotes: \`obsidian tasknotes:start-time\`,
  \`tasknotes:stop-time\`, \`tasknotes:time-status\`.
- Output is plain text by default; add \`format=json\` where offered when you
  need to parse it.
`;
}
