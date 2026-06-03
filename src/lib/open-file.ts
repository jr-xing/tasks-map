import { App, FileView, WorkspaceLeaf } from "obsidian";

function getLeafFilePath(leaf: WorkspaceLeaf): string | null {
  const fileView = leaf.view as FileView;
  if (fileView?.file?.path) return fileView.file.path;

  const state = leaf.getViewState();
  const file = state?.state?.file;
  return typeof file === "string" ? file : null;
}

/**
 * Find a leaf that already has the given file open.
 * Checks both loaded views and deferred/unactivated tabs.
 */
export function findLeafWithFile(
  app: App,
  filePath: string
): WorkspaceLeaf | null {
  let foundLeaf: WorkspaceLeaf | null = null;

  app.workspace.iterateAllLeaves((leaf) => {
    if (foundLeaf) return;
    if (getLeafFilePath(leaf) === filePath) {
      foundLeaf = leaf;
    }
  });

  return foundLeaf;
}

function stripLinkFragment(linktext: string): string {
  return linktext.split("#")[0].trim();
}

/**
 * Open an Obsidian file/link, reusing an existing leaf when possible.
 */
export async function openFileInObsidian(
  app: App,
  filePath: string,
  linktext: string = filePath,
  sourcePath: string = ""
): Promise<void> {
  const resolvedFile = app.metadataCache.getFirstLinkpathDest(
    stripLinkFragment(linktext),
    sourcePath
  );
  const targetPath = resolvedFile?.path || filePath;
  const existingLeaf = findLeafWithFile(app, targetPath);

  if (existingLeaf) {
    await app.workspace.revealLeaf(existingLeaf);
    app.workspace.setActiveLeaf(existingLeaf, { focus: true });
    return;
  }

  await app.workspace.openLinkText(linktext, sourcePath);
}
