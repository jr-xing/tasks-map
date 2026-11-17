import React from "react";
import { NodeProps } from "reactflow";
import type { TreeDot, TreeLine } from "src/lib/layout";

const DOT_RADIUS = 5;

export interface TreeGutterDot extends TreeDot {
  color: string;
}

export interface TreeGutterNodeData {
  width: number;
  height: number;
  lines: TreeLine[];
  dots: TreeGutterDot[];
}

/** Draws the git-style lanes, branch curves and status dots of tree mode. */
export default function TreeGutterNode({
  data,
}: NodeProps<TreeGutterNodeData>) {
  const { width, height, lines, dots } = data;
  return (
    <svg
      className="tasks-map-tree-gutter"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      {lines.map((line) => (
        <path
          key={line.key}
          className={`tasks-map-tree-line tasks-map-tree-line--${line.kind}`}
          d={line.path}
        />
      ))}
      {dots.map((dot) => (
        <circle
          key={dot.id}
          className="tasks-map-tree-dot"
          cx={dot.x}
          cy={dot.y}
          r={DOT_RADIUS}
          fill={dot.color}
        />
      ))}
    </svg>
  );
}
