# grayspace

grayspace is a workspace-oriented file browser for Windows using Tauri (Rust + React JS). It is a file manager, but each folder can act as a configurable workspace with panels, scripts, and local tooling.

It's a personal project, don't expect it to replace Windows file explorer for you anytime soon.

## what is there

Usable scaffolding, but missing core file-manager features.

* multi-window, tabs, arbitrary panels
* workspace detection + layout persistence
* filesystem panel (basic ops, folder tree / details / grid / foldable grid views, sorting, thumbnails for images, videos and anything Windows can thumbnail, watcher)
* terminal (Git Bash, multi instances)
* preview (media + text editing via CodeMirror, tabbed)
* file properties (read-only)
* drag & drop in/out
* custom context menu with submenus, plus the Windows context menu ("Show More Options" / `Shift+Right-click`)
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
* `ffmpeg.exe` (any recent build, e.g. from gyan.dev) copied to `src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe`; it's bundled for video thumbnails and kept out of git, and the Rust build fails without it

Install and run:

```
npm install
npm run tauri_dev
```

## opening from outside

* `grayspace.exe <folder>` opens the folder; `grayspace.exe <file>` opens its folder with the file selected
* only one instance runs: launching again with a path opens it as a new tab in the last focused window, launching again without one opens a new window

## keyboard shortcuts

### active

* `Ctrl+Shift+P` open command palette
* `Ctrl+T` new tab
* `Ctrl+N` new window
* `Ctrl+Tab` switch to next tab
* `Ctrl+F4` or middle-click tab: close tab
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
  * `Ctrl+C` / `Ctrl+X` / `Ctrl+V` copy / cut / paste (shares the Windows clipboard)
  * `Ctrl+Shift+T` create text file and rename immediately
  * `Ctrl+Shift+N` create folder and rename immediately
  * `Ctrl+Z` undo filesystem action
  * `Ctrl+Y` redo filesystem action
  * `Ctrl+L` or `Alt+D` focus breadcrumb path input
  * `Ctrl+F` filter current folder by name (`Enter` / `Arrow Down` back to the list, `Esc` clears; cleared when leaving the folder)
  * `Ctrl+Shift+F` search current folder and subfolders by name; results replace the listing and work like normal entries (first 5000 matches, symlinks/junctions not followed); `Ctrl+F` / `Ctrl+Shift+F` inside the box switch between filter and search
  * `Ctrl+Wheel` change thumbnail size
  * view type (folder tree / details / grid / foldable grid) from command palette or context menu; remembered per workspace, or per folder outside workspaces
  * sort by name / date modified / size / type from details column headers, command palette or context menu ("Sort By"); same key again reverses the order; remembered with the view type
  * mouse: middle-click folder or `Ctrl+DoubleClick` folder opens it in a new tab
  * `Shift+Right-click` (or "Show More Options" in the context menu) opens the Windows context menu for the selection or the folder background (7-Zip, Git, "Open with", "Send to", ...); `Shift+Right-click` also lists the extended entries (e.g. "Copy as path"); Open and Rename picked there run grayspace's own versions
* text preview:
  * `Ctrl+Wheel` change font size

### planned (inactive)

* `Ctrl+Space` toggle active pane maximize
* `F2` (multiple selection) bulk rename

## TODO

### global

* [x] multiple panels + layout system
* [x] multiple windows and tabs
* [x] drag in/out of app
* [ ] menu bar
* [x] custom context menu
  * [ ] custom commands, global and per workspace
  * [x] multi-level entries
* [x] command palette window (`Ctrl+Shift+P`)
* [x] settings panel with read-only command list
* [ ] global config system
* [x] remove the native window bar at the top, add draggable region and minimize/maximize/close buttons
* [ ] when closing a tab, first check if any panels don't require a confirmation
* [ ] when closing a window, first check if tabs don't require a confirmation
* [ ] trigger thumbnail cache pruning
* [ ] remember last window's size and position
* [x] open a folder / file passed on the command line
* [x] single instance (later launches open a tab or window in the running app)

### workspaces

* [x] `.grayspace/folder.json`
* [x] layout persistence
* [ ] auto-run commands on open
* [ ] UI for workspace config
* [x] per-workspace css
* [ ] folder preview and thumbnail
* [x] add better scrollbars
* [x] persist scroll position on tab switch
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
  * [x] video thumbnails from the bundled ffmpeg (frame at about 25% of the length, black or blank frames skipped, 15 s limit per video)
  * [x] everything else Windows can thumbnail, same as Explorer (fonts, Office files, ...; PDF / EPUB only with a thumbnailer installed, e.g. PowerToys)
  * own thumbnails where Windows has none:
    * [ ] audio covers (`lofty` ?)
    * [ ] pdf (`pdfium-render` ?)
    * [ ] epub
* [x] rename (F2)
  * [ ] bulk rename
* [x] copy / move / delete run in the background (progress and Cancel in the panel header)
  * [x] name conflicts ask: Replace (old item to the Recycle Bin) / Keep both / Skip
  * [x] copying into the same folder keeps both
  * [ ] merge folders on Replace (currently the whole folder is replaced)
  * [ ] operation queue (the panel waits for its running operation)
* [x] cut / copy / paste
  * [x] system integration
* [x] undo (ctrl+z)
* [x] keyboard navigation
* [x] path input / navigation
* [x] back/forward history
* [x] filter current folder (`Ctrl+F`)
* [x] recursive search (`Ctrl+Shift+F`)
  * [ ] skip list (`node_modules`, `.git`, ...)
  * [ ] content search
* [x] Windows context menu ("Open with", "Send to", shell extensions)
  * [ ] own "open with" list
* [ ] drag between tabs
* [ ] history
* [x] thumbnail sizing (incl. `Ctrl+Wheel`)
* [x] grid / foldable grid views
  * [x] persist view type and thumbnail size per workspace, and per folder outside workspaces
* [x] details view (date modified, type, size columns)
  * [ ] resizable / configurable columns
* [x] sorting (name / date modified / size / type, natural order, folders first)
* [x] hidden files dimmed
  * [ ] toggle to hide them
* [ ] filters (incl. custom JS)
* [ ] archive (zip, rar, 7z, etc) operations
* [ ] add middle click on breadcrumbs and drives
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
* [x] add a separate tab system
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
