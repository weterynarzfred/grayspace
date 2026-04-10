# grayspace

grayspace is a workspace-oriented file browser for Windows using Tauri (Rust + React JS). It is a file manager, but each folder can act as a configurable workspace with panels, scripts, and local tooling.

It's a personal project, don't expect it to replace Windows file explorer for you anytime soon.

## what is there

Usable scaffolding, but missing core file-manager features.

* multi-window, tabs, arbitrary panels
* workspace detection + layout persistence
* filesystem panel (basic ops, thumbnails for images, watcher)
* terminal (Git Bash, multi instances)
* preview (media + text editing via CodeMirror)
* file properties (read-only)
* drag & drop in/out
* custom context menu
* external UI panel from workspace config
* popover notifications and confirmation dialogs
* command palette + centralized command registry
* settings panel command list (read-only)

## run locally (windows)

This project is currently Windows-first.

Requirements:

* Node.js 20+
* Rust toolchain (`rustup`, `cargo`)
* Git for Windows (terminal panel currently has hardcoded `C:\Program Files\Git\bin\bash.exe`)

Install and run:

```
npm install
npm run tauri_dev
```

## keyboard shortcuts

### active

* `Ctrl+Shift+P` open command palette
* `Ctrl+T` new tab
* `Ctrl+N` new window
* `Ctrl+Tab` switch to next tab
* `Ctrl+F4` close tab
* `Alt+V` split active pane vertically
* `Alt+H` split active pane horizontally
* `Ctrl+Shift+E` switch active pane to filesystem
* `Ctrl+Shift+\`` switch active pane to terminal
* `Ctrl+Shift+V` switch active pane to preview
* `Ctrl+Shift+O` switch active pane to properties
* `Ctrl+Shift+U` switch active pane to external UI
* `Ctrl+R` open recently opened folders
* filesystem panel:
  * `Arrow Up/Down` move selection (loops)
  * `Shift+Arrow Up/Down` range selection
  * `Arrow Right/Left` expand/collapse selected folder
  * `Enter` open selected item(s)
  * `Ctrl+Enter` open selected folder in new tab
  * `Alt+ArrowLeft` go back in folder history
  * `Alt+ArrowRight` go forward in folder history
  * `Alt+Arrow Up` go one folder up (with workspace-exit confirmation when needed)
  * `Delete` delete selected item(s)
  * `F2` rename selected file/folder
  * `Ctrl+Shift+T` create text file and rename immediately
  * `Ctrl+Shift+N` create folder and rename immediately
  * `Ctrl+Z` undo filesystem action
  * `Ctrl+Y` redo filesystem action
  * `Ctrl+L` or `Alt+D` focus breadcrumb path input
  * mouse: middle-click folder or `Ctrl+DoubleClick` folder opens it in a new tab

### planned (inactive)

* `Ctrl+Space` toggle active pane maximize
* `F2` (multiple selection) bulk rename
* `Ctrl+F` filter current folder
* `Ctrl+Shift+F` search current folder and subfolders
* workspace script commands from `.grayspace/folder.json` in palette/context

## TODO

### global

* [x] multiple panels + layout system
* [x] multiple windows and tabs
* [x] drag in/out of app
* [ ] menu bar
* [x] custom context menu
  * [ ] custom commands, global and per workspace
* [x] command palette window (`Ctrl+Shift+P`)
* [x] settings panel with read-only command list
* [ ] global config system
* [x] remove the native window bar at the top, add draggable region and minimize/maximize/close buttons
* [ ] when closing a tab, first check if any panels don't require a confirmation
* [ ] when closing a window, first check if tabs don't require a confirmation
* [ ] trigger thumbnail cache pruning
* [ ] remember last window's size and position

### workspaces

* [x] `.grayspace/folder.json`
* [x] layout persistence
* [ ] auto-run commands on open
* [ ] UI for workspace config
* [x] per-workspace css
* [ ] folder preview and thumbnail
* [x] add better scrollbars
* [ ] persist scroll position on tab switch
* [ ] refresh the panel when `folder.json` is edited
* [x] add custom scripts to command palette

### QOL

* [x] new folder / new file shortcuts
* [x] tab switching shortcuts
* [x] panel switching shortcuts
* [x] folder history search / recent folders popover (`Ctrl+R`)

### filesystem (ctrl + shift + e)

* [x] navigation + selection
* [x] drag move
* [x] delete
* [x] multi-select
* [x] watcher
* [x] breadcrumbs
* [x] icons
* [x] basic thumbnails
  * [ ] video thumbnails (`ffmpeg-next` + bundled `ffmpeg` ?)
  * [ ] audio thumbnails (cover extraction via `lofty` ?)
  * [ ] pdf thumbnails (`pdfium-render` ?)
  * [ ] epub thumbnails
  * [ ] font thumbnails
  * [ ] maybe try integrating providers through the Windows shell?
* [x] rename (F2)
  * [ ] bulk rename
* [x] cut / copy / paste
  * [x] system integration
* [x] undo (ctrl+z)
* [x] keyboard navigation
* [x] path input / navigation
* [x] back/forward history
* [ ] search + filtering
* [ ] "open with"
* [ ] drag between tabs
* [ ] history
* [x] thumbnail sizing
* [ ] filters (incl. custom JS)
* [ ] archive (zip, rar, 7z, etc) operations
* [ ] add middle click on breadcrumbs, drives, and ".."
* [x] allow "sub" filesystem panels that don't hijack the workspace context
* [x] deselect file on empty space click
* [x] virtualize file lists in large folders

### terminal (ctrl + shift + `)

* [x] shell integration
* [x] multiple instances
* [ ] shell selection
* [ ] better coupling/decoupling from filesystem

### preview (ctrl + shift + v)

* [x] media + text preview/edit
* [x] sync with selection
* [x] lock preview
* [ ] slideshow
* add more preview types
  * [ ] pdf (https://github.com/mozilla/pdf.js ?)
  * [ ] csv/tsv
  * [ ] editable spreadsheets (https://github.com/jspreadsheet/ce ?)
  * [ ] editable svg (https://svg-edit.github.io/svgedit ?)
  * [ ] markdown editor (https://mdxeditor.dev/editor/docs/code-blocks ?)
  * [ ] json, yaml preview
  * [ ] docx
  * [ ] epub
  * [ ] fonts
  * [ ] maybe sqlite or other DB viewer/editor if there's anything nice
  * [ ] maybe try integrating providers through the Windows shell?

### properties (ctrl + shift + o)

* [x] basic info
* [ ] metadata support
* [ ] editable properties
* [ ] custom metadata (sidecar files)
* [ ] bulk properties when multiple files are selected

### external UI (ctrl + shift + u)

* [x] load URL from `.grayspace/folder.json` (`externalUI`) inside panel
* [ ] load HTML files

### canvas (ctrl + shift + g)

* [ ] define scope
* [ ] drawing interface (https://konvajs.org ?)
* [ ] files as objects
* [ ] file actions on file objects

## might get scrapped

* the whole canvas panel
