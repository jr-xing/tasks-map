import { MiniMap } from "reactflow";
import { TASK_GROUP_ZONE_TYPE } from "src/lib/layout/task-group-zones";

export const TaskMinimap = () => {
  // TODO: Would be nice to have better typing for node here
  const getNodeColor = (node: {
    type?: string;
    data?: { task?: { status?: string } };
  }) => {
    // Zones cover whole areas; drawing them would hide the cards.
    if (node.type === TASK_GROUP_ZONE_TYPE) return "transparent";
    const status = node.data?.task?.status;
    switch (status) {
      case "done":
        return "var(--tasks-map-color-green)";
      case "in_progress":
        return "var(--tasks-map-color-blue)";
      case "canceled":
        return "var(--tasks-map-color-red)";
      default:
        return "var(--background-secondary)";
    }
  };

  return (
    <MiniMap
      className="tasks-map-react-flow__minimap"
      nodeColor={getNodeColor}
      pannable
      zoomable
    />
  );
};
