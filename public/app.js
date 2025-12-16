const socket = io();
const editorElement = document.getElementById("editor");
const fileTree = document.getElementById("fileTree");
const editorHeader = document.getElementById("editorHeader");
let currentFile = null;
let isUpdatingFromServer = false;
let isOwnUpdate = false;
let fileMap = {};
let currentSessionId = null;
let remoteCursors = {};
let remoteCursorPositions = {};
let remoteUserNames = {};
let remoteCursorTimeouts = {};
let userColors = {};
let currentUserId = null;
let editor = null;
let saveTimeout = null;
let dmp = new diff_match_patch();
let lastContent = {};

socket.on("connect", () => {
    loadFiles();
});

socket.on("disconnect", () => {

});

async function loadFiles(parentId = null) {
    let params = parentId ? `?parentId=${parentId}` : "";
    if (currentSessionId) {
        params += (params ? '&' : '?') + `sessionId=${currentSessionId}`;
    }
    try {
        const response = await fetch(`/api/files${params}`);
        if (response.status === 401) {
            window.location.href = '/login';
            return;
        }
        const fetchedFiles = await response.json();
        if (parentId === null) {
            const expandedStates = {};
            Object.values(fileMap).forEach(file => {
                if (file.expanded) {
                    expandedStates[file._id] = true;
                }
            });

            fileMap = {};
            fetchedFiles.forEach(file => {
                file.children = [];
                file.expanded = expandedStates[file._id] || false;
                fileMap[file._id] = file;
            });

            Object.values(fileMap).forEach(file => {
                if (file.parentId && fileMap[file.parentId]) {
                    fileMap[file.parentId].children.push(file);
                }
            });
        } else {
            fetchedFiles.forEach(file => {
                file.children = [];
                file.expanded = false;
                fileMap[file._id] = file;
                if (fileMap[parentId]) {
                    fileMap[parentId].children.push(file);
                }
            });
        }
        renderFileTree();
        const rootFiles = Object.values(fileMap).filter(file => !file.parentId);
        if (rootFiles.length > 0 && !currentFile) {
            selectFile(rootFiles[0]);
        }
    } catch (error) {
        console.error('Erreur:', error);
    }
}

function renderFileTree() {
    fileTree.innerHTML = "";
    Object.values(fileMap).filter(file => !file.parentId).forEach(file => {
        renderFileItem(file, fileTree);
    });
}

function getFileIconPath(fileName) {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';

    if (typeof window.extToIconMap === 'undefined') {
        window.extToIconMap = {};
    }

    const commonExts = {
        // Programming languages
        'cpp': 'cpp', 'cc': 'cpp', 'cxx': 'cpp', 'c++': 'cpp',
        'c': 'c', 'h': 'cheader', 'hpp': 'cppheader', 'hxx': 'cppheader',
        'js': 'js', 'cjs': 'js', 'mjs': 'js', 'jsx': 'jsx',
        'ts': 'typescript', 'tsx': 'tsx', 'd.ts': 'typescriptdef',
        'py': 'python', 'pyi': 'python', 'pyx': 'python',
        'java': 'java', 'class': 'class', 'jar': 'jar',
        'php': 'php', 'phps': 'php', 'phtml': 'php',
        'rb': 'ruby', 'erb': 'erb', 'gemfile': 'bundler',
        'go': 'go', 'rs': 'rust', 'kt': 'kotlin', 'kts': 'kotlin',
        'scala': 'scala', 'sbt': 'sbt', 'groovy': 'groovy', 'gradle': 'gradle',
        'swift': 'swift', 'objective-c': 'objectivec', 'm': 'objectivec', 'mm': 'objectivecpp',
        'cs': 'csharp', 'csproj': 'csproj', 'fsx': 'fsharp', 'fs': 'fsharp',
        'lua': 'lua', 'pl': 'perl', 'pm': 'perl', 'sh': 'shell', 'bash': 'bash',
        'zsh': 'shell', 'fish': 'shell', 'ps1': 'powershell', 'psd1': 'powershell_psd',
        'psm1': 'powershell_psm', 'r': 'r', 'rmd': 'rmd', 'sql': 'sql', 'db': 'db',
        'asm': 'assembly', 's': 'assembly', 'vb': 'vb', 'vbs': 'vb', 'asp': 'asp',
        'aspx': 'aspx', 'jsp': 'jsp', 'gsql': 'sql', 'gql': 'graphql',
        'clj': 'clojure', 'cljs': 'clojurescript', 'edn': 'clojure',
        'lisp': 'lisp', 'el': 'emacs', 'scm': 'lisp', 'hs': 'haskell',
        'elm': 'elm', 'erl': 'erlang', 'ex': 'elixir', 'exs': 'elixir',
        'zig': 'zig', 'z': 'zig', 'jl': 'julia', 'ml': 'ocaml', 'mli': 'ocaml_intf',
        'pas': 'delphi', 'pp': 'delphi', 'vala': 'vala', 'vapi': 'vapi',
        'nim': 'nim', 'nims': 'nim', 'd': 'dlang', 'pro': 'pro', 'pl': 'prolog',
        'ml': 'ocaml', 'bal': 'ballerina', 'pest': 'pest', 'pkl': 'pkl',
        'ada': 'ada', 'ads': 'ada', 'adb': 'ada', 'f': 'fortran', 'f90': 'fortran',
        'f95': 'fortran', 'f03': 'fortran', 'f08': 'fortran', 'lasso': 'lasso',
        'tex': 'tex', 'latex': 'tex', 'sty': 'tex', 'cls': 'tex',
        'cobol': 'cobol', 'cbl': 'cobol', 'cob': 'cobol', 'jcl': 'jcl',
        'gdscript': 'gdscript', 'gd': 'gdscript', 'tres': 'tres', 'tscn': 'tscn',
        'gml': 'gamemaker', 'yy': 'gamemaker', 'yyx': 'gamemaker',
        'mojo': 'mojo', 'mojolicious': 'mojolicious',
        // Web & Markup
        'html': 'html', 'htm': 'html', 'xhtml': 'html', 'xml': 'xml', 'xsd': 'xml',
        'xsl': 'xml', 'dtd': 'xml', 'svg': 'svg', 'svgz': 'svg', 'vue': 'vue',
        'svelte': 'svelte', 'astro': 'astro', 'razor': 'razor', 'cshtml': 'razor',
        'vbhtml': 'vbhtml', 'jinja': 'jinja', 'j2': 'jinja', 'jinja2': 'jinja',
        'ejs': 'ejs', 'haml': 'haml', 'pug': 'pug', 'jade': 'pug', 'hbs': 'handlebars',
        'handlebars': 'handlebars', 'liquid': 'liquid', 'twig': 'twig',
        'nunjucks': 'nunjucks', 'mustache': 'mustache', 'tpl': 'mustache',
        'erb': 'erb', 'eex': 'eex', 'heex': 'eex', 'leex': 'eex',
        'slim': 'slim', 'slimrb': 'slim', 'dust': 'dustjs', 'dwt': 'dustjs',
        'mako': 'mako', 'marko': 'marko', 'mjml': 'mjml', 'apib': 'apib',
        'markdown': 'markdown', 'md': 'markdown', 'mdx': 'mdx', 'rst': 'markdown',
        'adoc': 'asciidoc', 'asciidoc': 'asciidoc', 'mdown': 'markdown',
        'mkdn': 'markdown', 'mkd': 'markdown', 'markdown.liquid': 'markdown',
        // Styles
        'css': 'css', 'scss': 'scss', 'sass': 'sass', 'less': 'less', 'sss': 'sss',
        'styl': 'stylus', 'pcss': 'postcss', 'postcss': 'postcss',
        // Data
        'json': 'json', 'json5': 'json5', 'jsonc': 'json', 'jsonld': 'jsonld',
        'geojson': 'geojson', 'ndjson': 'json', 'yml': 'yaml', 'yaml': 'yaml',
        'toml': 'toml', 'ini': 'ini', 'conf': 'config', 'cfg': 'config',
        'csv': 'csv', 'tsv': 'csv', 'tab': 'csv', 'xls': 'excel', 'xlsx': 'excel',
        'xlsm': 'excel', 'xlt': 'excel', 'xlm': 'excel', 'xlc': 'excel',
        'ods': 'calc', 'numbers': 'numbers', 'dbf': 'dbf',
        // Formats
        'txt': 'text', 'rtf': 'text', 'tex': 'tex', 'latex': 'tex',
        'log': 'log', 'out': 'log', 'msg': 'outlook', 'eml': 'outlook',
        'pdf': 'pdf', 'ps': 'postscript', 'eps': 'eps', 'ai': 'ai',
        'psd': 'photoshop', 'psb': 'photoshop', 'sketch': 'sketch',
        'fig': 'fig', 'xd': 'xd', 'afdesign': 'affinitydesigner',
        'afphoto': 'affinityphoto', 'afpub': 'affinitypublisher',
        'blend': 'blender', 'blend1': 'blender', 'fbx': 'fbx', 'obj': 'obj',
        'gltf': 'gltf', 'glb': 'gltf', '3ds': '3ds', 'dae': 'dae',
        'zig': 'zig', 'zl': 'zl', 'wgsl': 'wgsl', 'glsl': 'glsl', 'vert': 'glsl',
        'frag': 'glsl', 'hlsl': 'hlsl', 'fx': 'hlsl', 'metal': 'metal',
        // Archives
        'zip': 'zip', '7z': '7z', 'tar': 'tar', 'gz': 'gz', 'gzip': 'gz',
        'rar': 'rar', 'bz2': 'bz2', 'xz': 'xz', 'iso': 'iso', 'dmg': 'dmg',
        // Config
        'gitignore': 'git', 'gitattributes': 'git', 'gitconfig': 'git',
        'editorconfig': 'editorconfig', 'prettierrc': 'prettier', 'eslintrc': 'eslint',
        'babelrc': 'babel', 'npmrc': 'npm', 'yarnrc': 'yarn',
        'nvmrc': 'node', 'dockerignore': 'docker', 'dockerignore': 'docker',
        'env': 'dotenv', 'envexample': 'dotenv', 'browserslistrc': 'browserslist',
        // Build & Package
        'package': 'package', 'gemfile': 'bundler', 'dockerfile': 'docker',
        'docker-compose': 'docker', 'podfile': 'cocoapods', 'Cartfile': 'carthage',
        'makefile': 'make', 'cmake': 'cmake', 'cargo': 'cargo', 'cabal': 'cabal',
        'mix': 'mix', 'rebar': 'rebar', 'sbt': 'sbt', 'maven': 'maven',
        'gradle': 'gradle', 'bazel': 'bazel', 'build': 'bazel', 'dune': 'dune',
        'edn': 'clojure', 'lein': 'leiningen', 'boot': 'boot', 'shadow-cljs': 'clojurescript',
        'tsconfig': 'tsconfig', 'jsconfig': 'jsconfig', 'rollup': 'rollup',
        'webpack': 'webpack', 'vite': 'vite', 'gulp': 'gulp', 'grunt': 'grunt',
        'jake': 'jake', 'task': 'task', 'just': 'just', 'meson': 'meson',
        // Documentation
        'readme': 'markdown', 'license': 'license', 'license-bsd': 'license',
        'license-gpl': 'license', 'license-apache': 'license', 'license-mit': 'license',
        'license-mpl': 'license', 'authors': 'markdown', 'changelog': 'markdown',
        'changes': 'markdown', 'history': 'markdown', 'todo': 'todo', 'notes': 'markdown',
        'contributing': 'markdown', 'code_of_conduct': 'markdown',
        'codeowners': 'codeowners', 'funding': 'funding',
        // CI/CD
        'travis': 'travis', 'circle': 'circleci', 'gitlab-ci': 'gitlab',
        'bitbucket-pipelines': 'bitbucketpipeline', 'azure-pipelines': 'azurepipelines',
        'github-workflows': 'github', '.github': 'github', 'renovate': 'renovate',
        'dependabot': 'dependabot', 'snyk': 'snyk', 'codeql': 'codeql',
        'codacy': 'codacy', 'codecov': 'codecov', 'coveralls': 'coveralls',
        'coverage': 'coverage', 'drone': 'drone', 'jenkins': 'jenkins',
        // Other
        'video': 'video', 'mp4': 'video', 'avi': 'video', 'mov': 'video',
        'mkv': 'video', 'webm': 'video', 'flv': 'video', 'wmv': 'video',
        'image': 'image', 'jpg': 'image', 'jpeg': 'image', 'png': 'image',
        'gif': 'image', 'bmp': 'image', 'tiff': 'image', 'tif': 'image',
        'ico': 'image', 'webp': 'image', 'avif': 'image',
        'audio': 'audio', 'mp3': 'audio', 'wav': 'audio', 'flac': 'audio',
        'ogg': 'audio', 'aac': 'audio', 'm4a': 'audio', 'wma': 'audio',
        'font': 'font', 'ttf': 'font', 'otf': 'font', 'woff': 'font',
        'woff2': 'font', 'eot': 'font', 'fnt': 'font'
    };
    
    const iconName = commonExts[ext] || ext;
    return `/public/icons/file_type_${iconName}.svg`;
}

function renderFileItem(file, container) {
    const li = document.createElement("li");
    li.className = `file-item ${file._id === currentFile?._id ? 'active' : ''}`;
    li.draggable = true;
    li.dataset.fileId = file._id;
    li.dataset.fileType = file.type;

    const expandIcon = file.type === "folder" && file.hasChildren ? (file.expanded ? "▼" : "▶") : "";
    let icon = "";
    
    if (file.type === "file") {
        const iconPath = getFileIconPath(file.name);
        icon = `<img src="${iconPath}" alt="file" style="width: 16px; height: 16px; display: inline-block; margin-right: 4px; vertical-align: middle;">`;
    } else if (file.type === "folder") {
        const folderIcon = file.expanded ? "default_folder_opened.svg" : "default_folder.svg";
        icon = `<img src="/public/icons/${folderIcon}" alt="folder" style="width: 16px; height: 16px; display: inline-block; margin-right: 4px; vertical-align: middle;">`;
    }
    
    const nameSpan = document.createElement("span");
    if (file.type === "folder") {
        nameSpan.innerHTML = `${expandIcon} ${icon} ${file.name}`;
    } else {
        nameSpan.innerHTML = `${icon} ${file.name}`;
    }

    if (file.type === "folder") {
        nameSpan.onclick = () => toggleExpand(file._id);
    } else {
        nameSpan.onclick = () => selectFile(file);
    }
    li.appendChild(nameSpan);

    const deleteBtn = document.createElement("span");
    deleteBtn.className = "delete";
    deleteBtn.textContent = "✕";
    deleteBtn.onclick = (e) => {
        e.stopPropagation();
        deleteFile(file._id);
    };
    li.appendChild(deleteBtn);
    li.addEventListener('dragstart', handleDragStart);
    li.addEventListener('dragover', handleDragOver);
    li.addEventListener('drop', handleDrop);

    container.appendChild(li);

    if (file.expanded) {
        const subUl = document.createElement("ul");
        subUl.className = "file-tree-nested";
        file.children.forEach(child => renderFileItem(child, subUl));
        container.appendChild(subUl);
    }
}

async function toggleExpand(fileId) {
    const file = fileMap[fileId];
    if (!file || file.type !== "folder") return;

    file.expanded = !file.expanded;
    if (file.expanded && file.children.length === 0) {
        await loadFiles(fileId);
    }
    renderFileTree();
}

function selectFile(file) {
    if (file.type === 'folder') {;
        editorElement.style.display = 'none';
        editorHeader.textContent = 'Select a file to edit';
        return;
    }
    editorElement.style.display = 'block';
    if (currentFile && currentFile._id === file._id) {
        return;
    }

    if (saveTimeout && currentFile) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
    }

    isUpdatingFromServer = true;
    const prevCursor = editor.getCursor();
    currentFile = file;
    const content = file.content || "";
    editor.setValue(content);
    editorHeader.textContent = file.name;

    // Initialize last content for diff tracking
    lastContent[file._id] = content;

    const lineCount = editor.lineCount();
    if (prevCursor.line < lineCount) {
        editor.setCursor(prevCursor);
    } else {
        editor.setCursor({line: Math.max(0, lineCount - 1), ch: 0});
    }
    
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const modeMap = {
        'js': 'javascript', 'jsx': 'javascript', 'mjs': 'javascript', 'cjs': 'javascript',
        'ts': 'typescript', 'tsx': 'typescript',
        'py': 'python',
        'java': 'text/x-java',
        'cpp': 'text/x-c++src', 'cc': 'text/x-c++src', 'cxx': 'text/x-c++src', 'c++': 'text/x-c++src',
        'c': 'text/x-csrc', 'h': 'text/x-csrc',
        'cs': 'text/x-csharp',
        'php': 'application/x-httpd-php',
        'rb': 'text/x-ruby',
        'go': 'text/x-go',
        'rs': 'text/x-clike',
        'kt': 'text/x-clike',
        'swift': 'text/x-clike',
        'sql': 'text/x-sql',
        'html': 'htmlmixed', 'htm': 'htmlmixed',
        'xml': 'application/xml', 'svg': 'application/xml',
        'css': 'text/css', 'scss': 'text/x-scss', 'sass': 'text/x-sass', 'less': 'text/x-less',
        'json': 'application/json', 'json5': 'application/json',
        'yaml': 'text/x-yaml', 'yml': 'text/x-yaml',
        'toml': 'text/x-toml',
        'markdown': 'text/x-markdown', 'md': 'text/x-markdown', 'mdx': 'text/x-markdown',
        'sh': 'application/x-sh', 'bash': 'application/x-sh', 'zsh': 'application/x-sh',
        'ps1': 'application/x-powershell', 'psd1': 'application/x-powershell',
        'lua': 'text/x-lua',
        'r': 'text/x-rsrc', 'rmd': 'text/x-rsrc',
        'dockerfile': 'text/x-clike',
        'makefile': 'text/x-sh',
        'make': 'text/x-sh',
        'cmake': 'text/x-sh',
        'gradle': 'text/x-java',
        'groovy': 'text/x-java',
        'clj': 'text/x-clojure', 'cljs': 'text/x-clojure',
        'lisp': 'text/x-common-lisp', 'el': 'text/x-common-lisp',
        'hs': 'text/x-haskell',
        'scm': 'text/x-scheme',
        'vb': 'text/x-vb',
        'diff': 'text/x-diff', 'patch': 'text/x-diff'
    };
    
    const mode = modeMap[ext] || 'null';
    editor.setOption('mode', mode);

    document.querySelectorAll('.file-item').forEach(item => {
        if (item.dataset.fileId === file._id) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
    
    Object.keys(remoteCursors).forEach(userId => {
        removeRemoteCursor(userId);
    });
    
    isUpdatingFromServer = false;
}

function createFile() {
    const name = prompt("Nom du fichier:");
    if (!name) return;

    fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type: "file", parentId: null, sessionId: currentSessionId })
    }).then(() => loadFiles());
}

function createFolder() {
    const name = prompt("Folder name:");
    if (!name) return;

    fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type: "folder", parentId: null, sessionId: currentSessionId })
    }).then(() => loadFiles());
}

function deleteFile(id) {
    if (confirm("Delete this file ?")) {
        fetch(`/api/files/${id}`, { method: "DELETE" })
            .then(() => {
                if (currentFile?._id === id) {
                    currentFile = null;
                    editor.setValue("");
                    editorHeader.textContent = "File deleted";
                }
                loadFiles();
            });
    }
}

function logout() {
    window.location.href = '/logout';
}

function sendCursorPosition() {
    if (currentFile && currentSessionId && currentUserId) {
        const cursor = editor.getCursor();
        socket.emit('cursorMove', {
            sessionId: currentSessionId,
            userId: currentUserId,
            fileId: currentFile._id,
            position: cursor
        });
    }
    else if (currentFile && currentSessionId && !currentUserId) {
        Object.keys(remoteCursors).forEach(userId => {
            socket.emit('cursorMove', {
                sessionId: currentSessionId,
                userId: userId,
                fileId: currentFile._id,
                position: remoteCursors[userId]
            });
            console.log('Sent cursor position for user: ', userId, ', position: ',remoteCursors[userId]);
        });
        
    }
}

function getUserColor(userId) {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        const char = userId.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 70%, 50%)`;
}

function updateRemoteCursor(userId, position, userName) {
    remoteUserNames[userId] = userName;
    const userColor = getUserColor(userId);
    if (!remoteCursors[userId]) {
        const container = document.createElement('div');
        container.id = `cursor-${userId}`;
        container.style.position = 'absolute';
        container.style.pointerEvents = 'none';
        container.style.zIndex = '999';
        container.style.display = 'none';
        container.style.overflow = 'visible';

        const cursor = document.createElement('div');
        cursor.style.width = '2px';
        cursor.style.height = '20px';
        cursor.style.backgroundColor = userColor;
        cursor.style.position = 'absolute';
        cursor.style.top = '0';
        cursor.style.left = '0';

        const label = document.createElement('div');
        label.style.position = 'absolute';
        label.style.bottom = '0px';
        label.style.fontSize = '11px';
        label.style.backgroundColor = userColor;
        label.style.color = 'white';
        label.style.padding = '2px 4px';
        label.style.borderRadius = '2px';
        label.style.whiteSpace = 'nowrap';
        label.style.fontWeight = 'bold';
        label.style.fontFamily = 'monospace';
        label.style.zIndex = '1000';
        label.style.opacity = '1';
        label.style.transition = 'opacity 0.5s ease-out';
        label.textContent = userName;

        container.appendChild(cursor);
        container.appendChild(label);

        const gutters = document.querySelector('.CodeMirror-gutters');
        if (gutters && gutters.parentNode) {
            gutters.parentNode.appendChild(container);
        } else {
            editor.getWrapperElement().appendChild(container);
        }

        remoteCursors[userId] = container;
    }
    
    try {
        const lineCount = editor.lineCount();
        let adjustedPosition = { ...position };
        
        if (adjustedPosition.line >= lineCount) {
            adjustedPosition.line = Math.max(0, lineCount - 1);
            adjustedPosition.ch = 0;
        }

        remoteCursorPositions[userId] = adjustedPosition;
        
        const coords = editor.cursorCoords(adjustedPosition, 'page');
        const editorRect = editor.getWrapperElement().getBoundingClientRect();
        remoteCursors[userId].style.left = (coords.left - editorRect.left) + 'px';
        remoteCursors[userId].style.top = (coords.top - editorRect.top) + 'px';
        remoteCursors[userId].style.display = 'block';

        const label = remoteCursors[userId].querySelector('div:nth-child(2)');
        if (label) {
            if (adjustedPosition.line === 0) {
                label.style.bottom = '-18px';
            } else {
                label.style.bottom = '0px';
            }

            if (remoteCursorTimeouts[userId]) {
                clearTimeout(remoteCursorTimeouts[userId]);
            }
            label.style.opacity = '1';
            remoteCursorTimeouts[userId] = setTimeout(() => {
                label.style.opacity = '0';
            }, 2000);
        }
    } catch (e) {
        console.error('Error updating remote cursor:', e);
    }
}

function removeRemoteCursor(userId) {
    if (remoteCursors[userId]) {
        if (remoteCursorTimeouts[userId]) {
            clearTimeout(remoteCursorTimeouts[userId]);
            delete remoteCursorTimeouts[userId];
        }
        remoteCursors[userId].remove();
        delete remoteCursors[userId];
        delete remoteCursorPositions[userId];
        delete remoteUserNames[userId];
        delete userColors[userId];
    }
}

function transformIndex(p, patches) {
    let new_p = p;
    for (const patch of patches) {
        let offset = patch.start1;
        if (Array.isArray(patch.diffs)) {
            for (const diff of patch.diffs) {
                const [op, text] = diff;
                if (op === 1) {
                    if (p >= offset) new_p += text.length;
                } else if (op === -1) {
                    if (p >= offset && p < offset + text.length) {
                        new_p = offset;
                    } else if (p >= offset + text.length) {
                        new_p -= text.length;
                    }
                    offset += text.length;
                } else {
                    offset += text.length;
                }
            }
        } else {
            console.log('patch.diffs is not array', patch.diffs);
        }
    }
    return new_p;
}

function createSession() {
    const sessionId = crypto.randomUUID();
    currentSessionId = sessionId;
    currentUserId = crypto.randomUUID();
    localStorage.setItem('multicode_sessionId', sessionId);
    socket.emit('joinSession', sessionId);
    updateSessionUI();
    return sessionId;
}

function joinSession(sessionId) {
    currentSessionId = sessionId;
    currentUserId = crypto.randomUUID();
    localStorage.setItem('multicode_sessionId', sessionId);
    socket.emit('joinSession', sessionId);
    updateSessionUI();
}

function updateSessionUI() {
    const sessionInfo = document.getElementById('sessionInfo');
    const sessionIdSpan = document.getElementById('sessionId');
    const inviteBtn = document.getElementById('inviteBtn');

    if (currentSessionId) {
        sessionIdSpan.textContent = currentSessionId.slice(0, 8) + '...';
        sessionInfo.style.display = 'inline-block';
        inviteBtn.style.display = 'inline-block';
    } else {
        sessionInfo.style.display = 'none';
        inviteBtn.style.display = 'none';
    }
}

function inviteToSession() {
    if (!currentSessionId) {
        alert('No active session to invite to.');
        return;
    }
    const url = `${window.location.origin}/app?session=${currentSessionId}`;
    navigator.clipboard.writeText(url).then(() => {
        alert('Invitation link copied to clipboard !');
    });
}

let draggedElement = null;

function handleDragStart(e) {
    draggedElement = e.target;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.target.outerHTML);
    e.target.style.opacity = '0.5';
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();

    const draggedFileId = draggedElement.dataset.fileId;
    const draggedFileType = draggedElement.dataset.fileType;
    const targetFileId = e.target.closest('.file-item')?.dataset.fileId;
    const targetFileType = e.target.closest('.file-item')?.dataset.fileType;

    if ((draggedFileType === 'file' || draggedFileType === 'folder') && targetFileType === 'folder') {
        moveFileToFolder(draggedFileId, targetFileId);
    }

    draggedElement.style.opacity = '1';
    draggedElement = null;
    return false;
}

async function moveFileToFolder(fileId, folderId) {
    try {
        await fetch(`/api/files/${fileId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ parentId: folderId, sessionId: currentSessionId })
        });
        loadFiles();
    } catch (error) {
        console.error('Error while moving file:', error);
    }
}

socket.on('fileCreated', (newFile) => {
    newFile.children = [];
    newFile.expanded = false;
    fileMap[newFile._id] = newFile;
    if (newFile.parentId && fileMap[newFile.parentId]) {
        fileMap[newFile.parentId].children.push(newFile);
    }
    renderFileTree();
});

socket.on('fileUpdated', (updatedFile) => {
    if (fileMap[updatedFile._id]) {
        const oldFile = fileMap[updatedFile._id];
        const oldParentId = oldFile.parentId;
        Object.assign(fileMap[updatedFile._id], updatedFile);
        const newFile = fileMap[updatedFile._id];
        const newParentId = newFile.parentId;

        if (oldParentId && fileMap[oldParentId]) {
            fileMap[oldParentId].children = fileMap[oldParentId].children.filter(child => child._id !== updatedFile._id);
        }

        if (newParentId && fileMap[newParentId]) {
            fileMap[newParentId].children.push(newFile);
        }

        if (currentFile && currentFile._id === updatedFile._id) {
            isUpdatingFromServer = true;
            currentFile = fileMap[updatedFile._id];
            editor.setValue(currentFile.content || "");
            setTimeout(() => isUpdatingFromServer = false, 100);
        }
        renderFileTree();
    }
});

socket.on('fileContentUpdated', (data) => {
    if (currentFile && currentFile._id === data.fileId) {
        if (saveTimeout) {
            console.log('Ignoring content update while user is editing');
            return;
        }

        isUpdatingFromServer = true;
        const cursor = editor.getCursor();
        const patches = dmp.patch_fromText(data.patches);
        const results = dmp.patch_apply(patches, editor.getValue());
        const newContent = results[0];

        editor.operation(() => {
            editor.setValue(newContent);
            editor.setCursor(cursor);
        });

        Object.keys(remoteCursorPositions).forEach(userId => {
            const remoteCursor = remoteCursorPositions[userId];
            try {
                const remoteIndex = editor.indexFromPos(remoteCursor);
                const transformedIndex = transformIndex(remoteIndex, patches);
                const transformedRemoteCursor = editor.posFromIndex(transformedIndex);
                remoteCursorPositions[userId] = transformedRemoteCursor;
                updateRemoteCursor(userId, transformedRemoteCursor, remoteUserNames[userId]);
            } catch (e) {
                console.error('Error transforming remote cursor', e);
            }
        });

        lastContent[data.fileId] = newContent;
        setTimeout(() => isUpdatingFromServer = false, 100);
    }
});

socket.on('cursorUpdate', (data) => {
    if (data.userId !== currentUserId && currentFile && currentFile._id === data.fileId) {
        remoteCursorPositions[data.userId] = data.position;
        updateRemoteCursor(data.userId, data.position, data.userName);
    }
});

socket.on('userDisconnected', (userId) => {
    removeRemoteCursor(userId);
});

const urlParams = new URLSearchParams(window.location.search);
const sessionParam = urlParams.get('session');
const storedSessionId = localStorage.getItem('multicode_sessionId');

if (sessionParam) {
    joinSession(sessionParam);
} else if (storedSessionId) {
    joinSession(storedSessionId);
} else {
    createSession();
}

editor = CodeMirror(editorElement, {
    lineNumbers: true,
    mode: 'javascript',
    theme: 'default',
    lineWrapping: true,
    tabSize: 2,
    indentWithTabs: false,
    autoCloseBrackets: true,
    matchBrackets: true,
    styleActiveLine: true
});

editor.on('change', async (cm, change) => {
    if (currentFile && !isUpdatingFromServer && currentFile.type !== 'folder') {
        if (saveTimeout) clearTimeout(saveTimeout);

        saveTimeout = setTimeout(async () => {
            isOwnUpdate = true;
            try {
                const cursor = editor.getCursor();
                const currentContent = cm.getValue();
                const fileId = currentFile._id;
                const oldContent = lastContent[fileId] || "";
                const patches = dmp.patch_make(oldContent, currentContent);
                const patchText = dmp.patch_toText(patches);

                socket.emit('fileContentUpdate', {
                    sessionId: currentSessionId,
                    fileId: fileId,
                    patches: patchText
                });

                lastContent[fileId] = currentContent;

                editor.setCursor(cursor);
            } catch (error) {
                console.error('Error sending diff:', error);
            } finally {
                isOwnUpdate = false;
            }
        }, 5000);
    }
    sendCursorPosition();
});

editor.on('cursorActivity', sendCursorPosition);

loadFiles();