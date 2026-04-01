# Grayspace Product Goals

Grayspace is a desktop app for turning folders into configurable workspaces, built with Tauri + React.
It is not meant to be a full replacement for Windows Explorer.

Each folder can become a configurable workspace via a `.grayspace` subfolder.
The app should let users split the UI into an arbitrary pane layout and assign each pane a function.

Checked boxes mean "implemented in MVP form". Unchecked boxes are TODOs and ideas that may evolve.

## Target Pane Types

- Filesystem
- Terminal
- Scripts
- Canvas
- Properties
- Preview
- External UI

## TODO

### Workspace Config

- `.grayspace` folder per workspace
- required config file: `./.grayspace/folder.json` (may switch to `folder.js` later)
- config scaffold only; panel-specific feature TODOs should stay in panel sections

### Global functionality

- [x] multiple resizable panels
- [x] splitting the viewport to create new panels instead of just having the two
- [x] dragging files onto app
- [x] dragging files out of app
- [ ] add a menu bar
- [x] use multiple windows
- [x] use multiple tabs
- [ ] drag between tabs and windows
- [ ] custom context menu
- [x] panel type switcher
- workspace config features
  - [ ] auto-run commands when user opens the folder
  - [ ] pane-level display settings (for example custom CSS)
  - [x] pane state persistence (last layout/state)
- QOL
  - [ ] ctrl + r for folder history with search
  - [ ] ctrl + shift + n for new folder
  - [ ] ctrl + shift + t for new plain text file
  - [ ] `F2` rename selection
  - [ ] `Delete` move selection to recycle bin
  - [ ] `Ctrl + C / Ctrl + X / Ctrl + V` copy/cut/paste
  - [ ] `Ctrl + Z` undo last file operation
  - [ ] `Alt + Left / Alt + Right` folder back/forward
  - [ ] `Ctrl + Tab / Ctrl + Shift + Tab` next/previous global tab
  - [ ] `Ctrl + 1..9` focus pane by index
  - [ ] switch current panel keyboard shortcuts

### Filesystem Panel (ctrl + shift + e)

- [x] listing drives
- [x] folder traversal
- [x] selecting files and folders
- [x] opening files
- [x] drag to move file/folder
- [x] drag between panels
- [ ] drag between tabs
- [ ] cut, copy, and paste
- [ ] make cut, copy, and paste work between the app and with system file explorer
- [x] deleting files
- [ ] rename
- [x] select multiple files/folders
  - [x] support for ctrl and shift
  - [x] bulk drag
  - [ ] bulk cut, copy, and paste
  - [x] bulk delete
  - [ ] bulk rename with regex
- [ ] undo for file operations
- [ ] show in system explorer
- [ ] keyboard navigation
- [x] filesystem watcher for auto-updates
- [x] breadcrumbs
- [ ] back/forward history
- [x] file/folder icons
- [ ] thumbnails with customizable display size
- [ ] filters, including custom js ones defined by user
- [ ] show files from subfolders with filters (eg ignoring node_modules or .git)
- [ ] custom rules for displaying folder icons/thumbnails
- [ ] double click on empty space navigates one folder up (same as "..")
- [ ] add lazyloading for large folders

### Terminal Panel (ctrl + shift + `)

- [x] integrate any shell
- [ ] select a shell
- [ ] multiple terminals at once with tabs - local to a terminal pane (not the same as global app tabs)
- [ ] fix terminal switching between folders when two filesystem panels are open
- [ ] add an option to disconnect terminal from the filesystem panel

### Scripts Panel (ctrl + shift + c)

- [x] load scripts from `./.grayspace/folder.json` and display them as buttons that run specified commands
- [ ] add proper styling

### Canvas Panel (ctrl + shift + g)

- [ ] v1 scope TBD
- [ ] drawing basic shapes
- [ ] adding text
- [ ] displaying files from the folder as object
  - [ ] file commands triggered from the objects
- [ ] object list
- [ ] object properties
- [ ] a lot of fancy editing tools

### Properties Panel

- [x] displays properties of files
  - [ ] include metadata
  - [ ] editing some properties would be great
- [ ] editable custom metadata saved in sidecar files `file.ext.grayspace`
  - [ ] tags that can be then filtered and searched for
  - [ ] notes
  - [ ] links to other files

### Preview Panel (ctrl + shift + v)

- [x] sync preview with filesystem selection
- [x] add a button for locking the preview panel on the current file
- [x] displays image files using native HTML
- [x] displays video files using native HTML
- [x] displays audio files using native HTML
- [x] displays plaintext files using native HTML
- [x] make text editable
- [ ] slideshow using current filtered files

### External UI Panel

- [ ] v1 scope TBD
- [ ] load an arbitrary app from localhost or an HTML file

## Things from above that look hard and might be scrapped
- cross-app file operations (app – system file explorer)
- undo for file operations
- persistent workspace state
- the whole canvas panel
