# Test Fixture Vault

This Obsidian vault serves as a test environment for the Tasks Map plugin development.

## Setup

The plugin is loaded via a symbolic link in `.obsidian/plugins/tasks-map/` that points to the root project directory. This means:

1. Run `npm run build` in the project root to compile the latest plugin version
2. Open this fixture vault in Obsidian to test the latest built version
3. Any changes you make to the plugin code will be reflected after rebuilding and reloading Obsidian

## Optional integrations

The fixture keeps TaskNotes and Tasks available for testing their optional editing and creation integrations. Inline checkbox task discovery uses Obsidian's native metadata index.
