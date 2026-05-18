import React, { useEffect, useRef, useState } from "react";
import { App, TFile } from "obsidian";
import {
  EmbeddableMarkdownEditorInstance,
  createEmbeddableMarkdownEditor,
} from "../lib/embeddable-markdown-editor";

interface MarkdownBodyEditorProps {
  app: App;
  /** Current body text (markdown source). */
  value: string;
  // eslint-disable-next-line no-unused-vars -- callback parameter convention
  onChange: (value: string) => void;
  placeholder?: string;
  /** Path of the task file being edited; improves embedded-link resolution. */
  filePath?: string;
  /**
   * Invoked on Ctrl/Cmd+S while the editor is focused. Return `true` when the
   * keypress was handled (so CodeMirror suppresses its default behavior).
   */
  onSave?: () => boolean;
}

/**
 * Body field backed by an embedded Obsidian markdown editor (CodeMirror Live
 * Preview) so the text renders as formatted markdown while editing. Falls back
 * to a plain textarea if the internal editor cannot be resolved.
 */
export default function MarkdownBodyEditor({
  app,
  value,
  onChange,
  placeholder,
  filePath,
  onSave,
}: MarkdownBodyEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<EmbeddableMarkdownEditorInstance | null>(null);
  // Keep the latest callbacks reachable without re-creating the editor.
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);
  const [fallback, setFallback] = useState(false);

  // Create the embedded editor once, on mount.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let file: TFile | null = null;
    if (filePath) {
      const found = app.vault.getAbstractFileByPath(filePath);
      if (found instanceof TFile) file = found;
    }

    try {
      editorRef.current = createEmbeddableMarkdownEditor(app, container, {
        value,
        placeholder: placeholder ?? "",
        file,
        onChange: (next) => onChangeRef.current(next),
        onSave: () => onSaveRef.current?.() ?? false,
      });
    } catch (error) {
      console.error("Failed to create embedded markdown editor:", error);
      setFallback(true);
    }

    return () => {
      editorRef.current?.destroy();
      editorRef.current = null;
    };
    // Editor is created once; value/placeholder/file are read at mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps, @eslint-react/exhaustive-deps
  }, []);

  // Push external value changes (NLP parse, async load) into the editor.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.value !== value) {
      editor.setValue(value);
    }
  }, [value]);

  if (fallback) {
    return (
      <textarea
        className="tasks-map-editor-textarea"
        rows={6}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return <div ref={containerRef} className="tasks-map-editor-markdown" />;
}
