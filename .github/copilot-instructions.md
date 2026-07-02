# Project Instructions

- [x] Verify that the copilot-instructions.md file in the .github directory is created.
  - Created for this workspace.
- [x] Clarify Project Requirements
  - Local lightweight panorama viewer for Windows users, implemented as a Vite TypeScript app.
- [x] Scaffold the Project
  - Scaffolded with Vite vanilla TypeScript in the project root.
- [x] Customize the Project
  - Replaced the starter page with a local folder-based panorama image library and Three.js viewer.
- [x] Install Required Extensions
  - No project-specific VS Code extensions were required.
- [x] Compile the Project
  - `npm run build` completed successfully.
- [x] Create and Run Task
  - Skipped; package scripts are sufficient for local development.
- [x] Launch the Project
  - Vite dev server is running at http://localhost:5173/.
- [x] Ensure Documentation is Complete
  - README.md exists and includes run, build, and feature notes.

## Development Notes

- Keep the app lightweight and local-first.
- Do not add a desktop shell unless the user explicitly asks for a packaged desktop app.
- Prefer focused TypeScript and Three.js changes over broad framework additions.
- Validate with `npm run build` before handing off.