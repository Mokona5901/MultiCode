const socket = io();
const editorElement = document.getElementById("editor");
const imageViewer = document.getElementById("imageViewer");
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

function updateEditorPadding(lineCount) {
    const editorWrapper = editor.getWrapperElement();
    editorWrapper.style.padding = '20px 0px 20px 10px';
}

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
    if (rootFiles.length === 0 && !currentFile) {
        editorElement.style.display = 'none';
        editorHeader.textContent = 'Select a file to edit';
    }
    } catch (error) {
        console.error('Erreur:', error);
    }
}

function renderFileTree() {
    fileTree.innerHTML = "";
    const rootFiles = Object.values(fileMap).filter(file => !file.parentId);
    rootFiles.sort((a, b) => {
        if (a.type === 'folder' && b.type !== 'folder') return -1;
        if (a.type !== 'folder' && b.type === 'folder') return 1;
        return a.name.localeCompare(b.name);
    });
    rootFiles.forEach(file => {
        renderFileItem(file, fileTree);
    });
}

function shortenFileName(name) {
    if (name.length <= 28) return name;
    const firstPart = name.substring(0, 10);
    const lastPart = name.substring(name.length - 10);
    return firstPart + "..." + lastPart;
}

function getFileIconPath(fileName) {
    const ext = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : '';

    if (typeof window.extToIconMap === 'undefined') {
        window.extToIconMap = {};
    }

    const commonExts = {
        // === Programming Languages ===
        'c':'c','cpp':'cpp','csharp':'csharp','fsharp':'fsharp','java':'java',
        'julia':'julia','python':'python','pythowo':'pythowo','r':'r','ruby':'ruby',
        'rust':'rust','rust_toolchain':'rust_toolchain','go':'go','gdscript':'gdscript',
        'vlang':'vlang','zig':'zig','elixir':'elixir','erlang':'erlang','haskell':'haskell',
        'nim':'nim','scala':'scala','swift':'swift','kotlin':'kotlin','ocaml':'ocaml',
        'ocaml_intf':'ocaml_intf','dlang':'dlang','lua':'lua','luau':'luau','perl':'perl',
        'ada':'ada','fortran':'fortran','cobol':'cobol','matlab':'matlab','sas':'sas',
        'uiua':'uiua','red':'red','reason':'reason','groovy':'groovy',

        // === Web & Markup ===
        'html':'html','xml':'xml','svg':'svg','vue':'vue','vueconfig':'vueconfig',
        'svelte':'svelte','svelteconfig':'svelteconfig','astro':'astro','astroconfig':'astroconfig','razor':'razor',
        'vbhtml':'vbhtml','jinja':'jinja','ejs':'ejs','haml':'haml','pug':'pug',
        'handlebars':'handlebars','liquid':'liquid','twig':'twig','mustache':'mustache','mdx':'mdx',
        'mdx-components':'mdx-components','mdxlint':'mdxlint','markdown':'markdown','asciidoc':'asciidoc',
        'mjml':'mjml','dustjs':'dustjs','marko':'marko','wikitext':'wikitext','xquery':'xquery','xsl':'xsl','yaml':'yaml',
        'yaml_official':'yaml_official','yamllint':'yamllint','yacc':'yacc',

        // === Styles ===
        'css':'css','scss':'scss','sass':'sass','less':'less','stylus':'stylus',
        'stylable':'stylable', 'sss':'sss','style':'style','styled':'styled','stylelint':'stylelint',
        'tailwind':'tailwind', 'tamagui':'tamagui','unocss':'unocss',

        // === Data Formats ===
        'json':'json','jsonld':'jsonld','jsonnet':'jsonnet','json_official':'json_official', 'json_schema':'json_schema',
        'ini':'ini','toml':'toml','csv':'csv','tsv':'tsv','map':'map',
        'excel':'excel','libreoffice_base':'libreoffice_base','libreoffice_calc':'libreoffice_calc',
        'libreoffice_draw':'libreoffice_draw','libreoffice_impress':'libreoffice_impress', 'libreoffice_math':'libreoffice_math',
        'libreoffice_writer':'libreoffice_writer','geojson':'geojson', 'db':'db','sqlite':'sqlite','pgsql':'pgsql',
        'mysql':'mysql','mariadb':'mariadb','neo4j':'neo4j', 'registry':'registry','ron':'ron',

        // === Archives & Binaries ===
        'zip':'zip','rar':'zip','7z':'zip','tar':'zip','gz':'zip',
        'bz2':'zip','xz':'zip','iso':'zip', 'binary':'binary','gpg':'gpg',

        // === Images & Graphics ===
        'image':'image','ai':'ai','avif':'avif','favicon':'favicon','fbx':'fbx',
        'gltf':'gltf', 'glyphs':'glyphs','ink':'ink','drawio':'drawio','excalidraw':'excalidraw',
        'photoshop':'photoshop', 'aseprite':'aseprite','blender':'blender','sketch':'sketch','xib':'xib',
        'xliff':'xliff', 'eps':'eps','epub':'epub','png':'image', 'jpg':'image', 'jpeg':'image',
        'gif':'image','svg':'image', 'bmp':'image', 'webp':'image', 'ico':'image',

        // === Audio & Video ===
        'audio':'audio','video':'video','wasm':'wasm','wgsl':'wgsl','hlsl':'hlsl','shaderlab':'shaderlab',

        // === Build & Tooling ===
        'babel':'babel','eslint':'eslint','prettier':'prettier','esbuild':'esbuild','swc':'swc',
        'rollup':'rollup','rolldown':'rolldown','vite':'vite','vitest':'vitest','webpack':'webpack',
        'gulp':'gulp','grunt':'grunt','npm':'npm','pnpm':'pnpm','yarn':'yarn','lerna':'lerna',
        'turbo':'turbo','craco':'craco','commitizen':'commitizen','commitlint':'commitlint',
        'husky':'husky','lefthook':'lefthook','renovate':'renovate','rome':'rome','stryker':'stryker',

        // === CI & DevOps ===
        'github':'github','gitlab':'gitlab','git':'git','gitpod':'gitpod','bitbucketpipeline':'bitbucketpipeline',
        'circleci':'circleci','travis':'travis','azurepipelines':'azurepipelines','jenkins':'jenkins',
        'codacy':'codacy','codecov':'codecov','codeclimate':'codeclimate','dependabot':'dependabot',
        'coverage':'coverage','coveralls':'coveralls','docker':'docker','dockertest':'dockertest',
        'opentofu':'opentofu','terraform':'terraform','kubernetes':'kubernetes','netlify':'netlify',
        'vercel':'vercel','serverless':'serverless','pulumi':'pulumi','greenkeeper':'greenkeeper',
        'snyk':'snyk','prometheus':'prometheus',

        // === Configs & Infra ===
        'editorconfig':'editorconfig','tsconfig':'tsconfig','tsconfig_official':'tsconfig_official',
        'tsdoc':'tsdoc','typedoc':'typedoc','jsconfig':'jsconfig','language_configuration':'language_configuration',
        'watchmanconfig':'watchmanconfig','procfile':'procfile','devcontainer':'devcontainer','dotenv':'dotenv',
        'config':'config','package':'package','vsix':'vsix','vsixmanifest':'vsixmanifest','vscode':'vscode',
        'vscode_test':'vscode_test','vscode-insiders':'vscode-insiders',

        // === Frameworks & Platforms ===
        'reactjs':'reactjs','reactts':'reactts','reactrouter':'reactrouter','reacttemplate':'reacttemplate',
        'next':'next','nuxt':'nuxt','nestjs':'nestjs','angular':'angular','aurelia':'aurelia','ember':'ember',
        'eleventy':'eleventy','docusaurus':'docusaurus','docz':'docz','gatsby':'gatsby','gridsome':'gridsome',
        'symfony':'symfony','rails':'rails','django':'django','php':'php','phpstan':'phpstan','phpunit':'phpunit',
        'phpcsfixer':'phpcsfixer','puppet':'puppet','ansible':'ansible','helm':'helm','histoire':'histoire',
        'hardhat':'hardhat','solidity':'solidity','vyper':'vyper','apollo':'apollo','graphql':'graphql',
        'graphql_config':'graphql_config',

        // === Databases & Cloud ===
        'aws':'aws','azure':'azure','gcloud':'gcloud','cloudflare':'cloudflare','elastic':'elastic',
        'elasticbeanstalk':'elasticbeanstalk','firebase':'firebase','firestore':'firestore','fitbit':'fitbit',
        'fastly':'fastly','fauna':'fauna','opam':'opam','opencl':'opencl','openscad':'openscad','openHAB':'openHAB',
        'ogone':'ogone',

        // === Miscellaneous ===
        'access':'access','actionscript':'actionscript','advpl':'advpl','affectscript':'affectscript',
        'affinitydesigner':'affinitydesigner','affinityphoto':'affinityphoto','affinitypublisher':'affinitypublisher',
        'agda':'agda','agents':'agents','al':'al','allcontributors':'allcontributors','alloy':'alloy','al_dal':'al_dal',
        'antlers_html':'antlers_html','antlr':'antlr','anyscript':'anyscript','apache':'apache','apex':'apex',
        'apib':'apib','api_extractor':'api_extractor','apl':'apl','applescript':'applescript','appscript':'appscript',
        'appsemble':'appsemble','appveyor':'appveyor','arduino':'arduino','atom':'atom','ats':'ats','attw':'attw',
        'autohotkey':'autohotkey','autoit':'autoit','avro':'avro','awk':'awk','bats':'bats','bazaar':'bazaar',
        'bazel':'bazel','bazel_ignore':'bazel_ignore','bazel_version':'bazel_version','befunge':'befunge',
        'bicep':'bicep','biml':'biml','biome':'biome','bithound':'bithound','blade':'blade', 'blitzbasic':'blitzbasic',
        'bolt':'bolt','bosque':'bosque','bower':'bower','browserslist':'browserslist','bruno':'bruno','buckbuild':'buckbuild',
        'buf':'buf','bun':'bun','bundlemon':'bundlemon','bundler':'bundler','bunfig':'bunfig','cabal':'cabal','caddy':'caddy',
        'cake':'cake','cakephp':'cakephp','capacitor':'capacitor','capnp':'capnp','cargo':'cargo',
        'casc':'casc','cddl':'cddl','cert':'cert','ceylon':'ceylon','cf':'cf','cfc':'cfc','cfm':'cfm','changie':'changie',
        'cheader':'cheader','chef':'chef','chef_cookbook':'chef_cookbook','class':'class','claude':'claude','clojure':'clojure',
        'clojurescript':'clojurescript','cmake':'cmake','cursorrules':'cursorrules','cvs':'cvs','dal':'dal',
        'darcs':'darcs','dartlang':'dartlang','dartlang_generated':'dartlang_generated','dartlang_ignore':'dartlang_ignore',
        'datadog':'datadog','debian':'debian','delphi':'delphi','deno':'deno','denoify':'denoify','dependencies':'dependencies',
        'dhall':'dhall','diff':'diff','dojo':'dojo','doppler':'doppler','dotjs':'dotjs','doxygen':'doxygen','drone':'drone',
        'drools':'drools','dtd':'dtd','dune':'dune','dvc':'dvc','dylan':'dylan','earthly':'earthly',
        'eas-metadata':'eas-metadata','edge':'edge','eex':'eex','expo':'expo','falcon':'falcon','fantasticon':'fantasticon',
        'floobits':'floobits','flow':'flow','flutter':'flutter','flutter_package':'flutter_package','flyio':'flyio',
        'formkit':'formkit','fossa':'fossa','fossil':'fossil','freemarker':'freemarker','frontcommerce':'frontcommerce',
        'fsproj':'fsproj','fthtml':'fthtml','funding':'funding','fusebox':'fusebox','galen':'galen','gamemaker':'gamemaker',
        'gcode':'gcode','gemini':'gemini','genstat':'genstat','gnu':'gnu','gnuplot':'gnuplot','gleam':'gleam',
        'gleamconfig':'gleamconfig','glide':'glide','glimmer':'glimmer','glitter':'glitter',
        'harbour':'harbour','helix':'helix','homeassistant':'homeassistant','horusec':'horusec','host':'host',
        'htmlhint':'htmlhint','htmlvalidate':'htmlvalidate','http':'http','hugo':'hugo','humanstxt':'humanstxt',
        'hunspell':'hunspell','hy':'hy','hygen':'hygen','hypr':'hypr','icl':'icl','idris':'idris','idrisbin':'idrisbin',
        'idrispkg':'idrispkg','imba':'imba','inc':'inc','infopath':'infopath','informix':'informix',
        'innosetup':'innosetup','io':'io','iodine':'iodine','ionic':'ionic','jake':'jake', 'janet':'janet','jar':'jar',
        'jasmine':'jasmine','jbuilder':'jbuilder','jekyll':'jekyll', 'juice':'juice','jpm':'jpm','js':'js',
        'jsbeautify':'jsbeautify', 'jscpd':'jscpd','jshint':'jshint','jsmap':'jsmap',
        'jsp':'jsp','jsr':'jsr','jss':'jss','js_official':'js_official','jupyter':'jupyter',
        'just':'just','k':'k','karma':'karma','key':'key','kitchenci':'kitchenci','kite':'kite','kivy':'kivy',
        'knip':'knip','kos':'kos','kusto':'kusto', 'lark':'lark','latino':'latino','layout':'layout','lean':'lean',
        'leanconfig':'leanconfig','lex':'lex','liara':'liara', 'license':'license','licensebat':'licensebat',
        'lighthouse':'lighthouse','lilypond':'lilypond', 'lime':'lime','lintstagedrc':'lintstagedrc','lisp':'lisp',
        'livescript':'livescript', 'lnk':'lnk','locale':'locale','log':'log','lolcode':'lolcode','lsl':'lsl','lync':'lync',
        'mailing':'mailing','manifest':'manifest','manifest_bak':'manifest_bak','manifest_skip':'manifest_skip',
        'markdownlint':'markdownlint','markdownlint_ignore':'markdownlint_ignore',
        'markojs':'markojs','markuplint':'markuplint','master-co':'master-co','maven':'maven', 'maxscript':'maxscript',
        'maya':'maya','mcp':'mcp','mediawiki':'mediawiki','mercurial':'mercurial','mermaid':'mermaid',
        'meson':'meson','metal':'metal','meteor':'meteor','minecraft':'minecraft','mivascript':'mivascript','mlang':'mlang',
        'mocha':'mocha','modernizr':'modernizr','mojo':'mojo','mojolicious':'mojolicious','moleculer':'moleculer',
        'mondoo':'mondoo','mongo':'mongo', 'monotone':'monotone','motif':'motif','mson':'mson','mvt':'mvt',
        'mvtcss':'mvtcss','mvtjs':'mvtjs','mypy':'mypy','nanostaged':'nanostaged','ndst':'ndst', 'nearly':'nearly',
        'nimble':'nimble','ninja':'ninja','nix':'nix','njsproj':'njsproj', 'noc':'noc','node':'node','nodemon':'nodemon',
        'npmpackagejsonlint':'npmpackagejsonlint','nsi':'nsi','nsri-integrity':'nsri-integrity','nsri':'nsri','nuget':'nuget',
        'numpy':'numpy', 'nunjucks':'nunjucks','nx':'nx','nyc':'nyc','objectivec':'objectivec','objectivecpp':'objectivecpp',
        'objidconfig':'objidconfig','onenote':'onenote','org':'org','outlook':'outlook', 'ovpn':'ovpn','oxc':'oxc',
        'packship':'packship','paket':'paket', 'pandacss':'pandacss','patch':'patch','pcl':'pcl','pddl':'pddl',
        'pddl_happenings':'pddl_happenings', 'pddl_plan':'pddl_plan','pdm':'pdm','peeky':'peeky','phraseapp':'phraseapp',
        'pine':'pine', 'pip':'pip','pipeline':'pipeline','plantuml':'plantuml','platformio':'platformio',
        'playwright':'playwright', 'plsql':'plsql','plsql_package':'plsql_package','plsql_package_body':'plsql_package_body',
        'plsql_package_header':'plsql_package_header','plsql_package_spec':'plsql_package_spec','pm2':'pm2',
        'poedit':'poedit','poetry':'poetry','polymer':'polymer', 'pony':'pony','postcss':'postcss',
        'postcssconfig':'postcssconfig','postman':'postman', 'powerpoint':'powerpoint','powershell':'powershell',
        'powershell_format':'powershell_format', 'powershell_psd':'powershell_psd','powershell_psm':'powershell_psm',
        'powershell_types':'powershell_types', 'preact':'preact','precommit':'precommit',
        'prisma':'prisma', 'processinglang':'processinglang','progress':'progress','prolog':'prolog',
        'protobuf':'protobuf','protractor':'protractor','publiccode':'publiccode','publisher':'publisher',
        'purescript':'purescript','purgecss':'purgecss', 'pyenv':'pyenv','pyret':'pyret','pyscript':'pyscript',
        'pytest':'pytest','pytyped':'pytyped', 'pyup':'pyup','q':'q','qbs':'qbs','qlikview':'qlikview','qml':'qml','qmldir':'qmldir',
        'qsharp':'qsharp','quasar':'quasar','racket':'racket','rake':'rake', 'raku':'raku','raml':'raml','razzle':'razzle',
        'ra_syntax_tree':'ra_syntax_tree','rescript':'rescript','rest':'rest','retext':'retext','rexx':'rexx','riot':'riot',
        'ripple':'ripple', 'rmd':'rmd','rnc':'rnc','robotframework':'robotframework','robots':'robots',
        'rproj':'rproj','rspec':'rspec','rss':'rss','rubocop':'rubocop','s-lang':'s-lang', 'safetensors':'safetensors',
        'sails':'sails','saltstack':'saltstack','san':'san', 'sapphire_framework_cli':'sapphire_framework_cli','sbt':'sbt',
        'scilab':'scilab','script':'script', 'sdlang':'sdlang','search_result':'search_result','seedkit':'seedkit',
        'sentry':'sentry', 'sequelize':'sequelize','shadcn':'shadcn','shuttle':'shuttle','silverstripe':'silverstripe',
        'sino':'sino','siyuan':'siyuan','skipper':'skipper','slang':'slang', 'slashup':'slashup','slice':'slice','slim':'slim','slint':'slint',
        'sln':'sln','smarty':'smarty', 'smithery':'smithery','snakemake':'snakemake','snapcraft':'snapcraft','snaplet':'snaplet',
        'snort':'snort','solidarity':'solidarity','source':'source', 'spacengine':'spacengine','sparql':'sparql',
        'spin':'spin','sqf':'sqf','sql':'sql','squirrel':'squirrel','sst':'sst','stackblitz':'stackblitz','stan':'stan','stata':'stata','stencil':'stencil',
        'storyboard':'storyboard','storybook':'storybook','stylish_haskell':'stylish_haskell','sublime':'sublime','subversion':'subversion',
        'svgo':'svgo','swagger':'swagger','swig':'swig','syncpack':'syncpack', 'systemd':'systemd','systemverilog':'systemverilog',
        't4tt':'t4tt','taplo':'taplo','taskfile':'taskfile','tauri':'tauri','tcl':'tcl','teal':'teal','templ':'templ', 'tera':'tera','test':'test',
        'testcafe':'testcafe','testjs':'testjs','testplane':'testplane', 'testts':'testts','tex':'tex','text':'text',
        'textile':'textile','tfs':'tfs','tiltfile':'tiltfile', 'tm':'tm','tmux':'tmux','todo':'todo','toit':'toit','tox':'tox','tree':'tree','tres':'tres','truffle':'truffle',
        'trunk':'trunk','tsbuildinfo':'tsbuildinfo', 'tscn':'tscn', 'tsdown':'tsdown','tslint':'tslint','tt':'tt',
        'ttcn':'ttcn','tuc':'tuc','typescript':'typescript','typescriptdef':'typescriptdef', 'typescriptdef_official':'typescriptdef_official',
        'typescript_official':'typescript_official','typo3':'typo3','unibeautify':'unibeautify','unison':'unison',
        'unlicense':'unlicense','uv':'uv','vagrant':'vagrant','vala':'vala','vanilla_extract':'vanilla_extract', 'vapi':'vapi',
        'vapor':'vapor','vash':'vash','vb':'vb','vba':'vba','vbproj':'vbproj', 'vcxproj':'vcxproj','velocity':'velocity','vento':'vento','verilog':'verilog',
        'vhdl':'vhdl','view':'view','vim':'vim','volt':'volt','wallaby':'wallaby','wally':'wally','wdio':'wdio','weblate':'weblate', 'wenyan':'wenyan',
        'wercker':'wercker','windi':'windi', 'wit':'wit','wolfram':'wolfram','word':'word','wpml':'wpml','wurst':'wurst','wxml':'wxml',
        'wxss':'wxss','wxt':'wxt','xcode':'xcode','xfl':'xfl','xmake':'xmake','xo':'xo', 'xorg':'xorg','yandex':'yandex','yang':'yang','yeoman':'yeoman'
    }
       
    const iconName = commonExts[ext] || 'unknown';
    if (iconName !== 'unknown') {
        return `/public/icons/file_type_${iconName}.svg`;
    } else {
        return `/public/icons/default_file.svg`;
    }
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
    nameSpan.className = "file-name";
    const displayName = shortenFileName(file.name);
    if (file.type === "folder") {
        nameSpan.innerHTML = `${expandIcon} ${icon} ${displayName}`;
    } else {
        nameSpan.innerHTML = `${icon} ${displayName}`;
    }

    if (file.type === "folder") {
        nameSpan.onclick = () => toggleExpand(file._id);
    } else {
        nameSpan.onclick = () => selectFile(file);
    }
    li.appendChild(nameSpan);

    const renameBtn = document.createElement("span");
    renameBtn.className = "rename";
    renameBtn.textContent = "✏️";
    renameBtn.onclick = (e) => {
        e.stopPropagation();
        renameFile(file._id);
    };
    li.appendChild(renameBtn);

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
    if (!file || file.type !== "folder" || !file.hasChildren) return;

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
    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'bmp', 'webp', 'ico'];
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const isImage = imageExtensions.includes(ext);
    if (isImage) {
        let base64Data;
        if (typeof file.content === 'string') {
            base64Data = file.content.replace(/\s/g, '');
        } else {
            console.error('Unsupported image content format');
            return;
        }
        imageViewer.innerHTML = `<img src="data:image/${ext === 'svg' ? 'svg+xml' : ext};base64,${base64Data}" style="height: 600px; width: auto; display: block; margin: 0 auto;" />`;
        imageViewer.style.display = 'block';
        editorElement.style.display = 'none';
        editorHeader.textContent = file.name;
        currentFile = file;
        lastContent[file._id] = file.content;
        document.querySelectorAll('.file-item').forEach(item => {
            if (item.dataset.fileId === file._id) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
        return;
    }
    // for text files
    editorElement.style.display = 'block';
    imageViewer.style.display = 'none';
    if (currentFile && currentFile._id === file._id) {
        return;
    }
    if (saveTimeout && currentFile) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
    }
    isUpdatingFromServer = true;
    currentFile = file;
    const content = file.content || "";
    if (!editor) {
        editor = CodeMirror(editorElement, {
            lineNumbers: true,
            mode: 'javascript',
            theme: "material-palenight",
            lineWrapping: true,
            tabSize: 2,
            indentWithTabs: false,
            autoCloseBrackets: true,
            matchBrackets: true,
            styleActiveLine: true
        });
        editor.setSize(null, '100%');

        // Calculate width for 150 characters to prevent horizontal scrolling
        const tempSpan = document.createElement('span');
        tempSpan.style.fontFamily = "'Courier New', monospace";
        tempSpan.style.fontSize = '14px';
        tempSpan.style.position = 'absolute';
        tempSpan.style.visibility = 'hidden';
        tempSpan.textContent = 'a'.repeat(150);
        document.body.appendChild(tempSpan);
        const textWidth = tempSpan.getBoundingClientRect().width;
        document.body.removeChild(tempSpan);
        const gutterWidth = editor.getGutterElement().offsetWidth;
        const totalWidth = textWidth + gutterWidth + 20;
        editorElement.parentElement.style.width = totalWidth + 'px';
        editorElement.parentElement.style.overflowX = 'hidden';
        editorElement.style.width = '100%';
        editorElement.style.overflowX = 'hidden';
        editor.getWrapperElement().style.overflowX = 'hidden';

        const container = document.querySelector('.container');
        editor.on('change', async (cm, change) => {
            if (currentFile && !isUpdatingFromServer && currentFile.type !== 'folder') {
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
            }
            sendCursorPosition();
        });
        editor.on('cursorActivity', sendCursorPosition);
        editor.on('scroll', () => {
            Object.keys(remoteCursors).forEach(userId => {
                if (remoteCursorPositions[userId]) {
                    updateRemoteCursor(userId, remoteCursorPositions[userId], remoteUserNames[userId]);
                }
            });
        });
    }
    const prevCursor = editor.getCursor();
    editor.setValue(content);
    editorHeader.textContent = file.name;
    lastContent[file._id] = content;
    const lineCount = editor.lineCount();
    if (prevCursor.line < lineCount) {
        editor.setCursor(prevCursor);
    } else {
        editor.setCursor({line: Math.max(0, lineCount - 1), ch: 0});
    }
    editor.refresh();

    updateEditorPadding(lineCount);

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
    const name = prompt("File name:");
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

function showImportOverlay() {
    const overlay = document.getElementById('importOverlay');
    overlay.style.display = 'flex';
}

function hideImportOverlay() {
    const overlay = document.getElementById('importOverlay');
    overlay.style.display = 'none';
}

function importArchive() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,.rar,.7z,.tar,.gz,.bz2,.xz';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        showImportOverlay();

        const formData = new FormData();
        formData.append('archive', file);
        formData.append('sessionId', currentSessionId || '');

        try {
            const response = await fetch('/api/import-archive', {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                loadFiles();
            } else {
                const error = await response.json();
                alert(`Import failed: ${error.error}`);
            }
        } catch (error) {
            console.error('Import error:', error);
            alert('Import failed due to network error');
        } finally {
            hideImportOverlay();
        }
    };
    input.click();
}

function importFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '*/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        showImportOverlay();

        const formData = new FormData();
        formData.append('file', file);
        formData.append('sessionId', currentSessionId || '');

        try {
            const response = await fetch('/api/import-file', {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                loadFiles();
            } else {
                const error = await response.json();
                alert(`Import failed: ${error.error}`);
            }
        } catch (error) {
            console.error('Import error:', error);
            alert('Import failed due to network error');
        } finally {
            hideImportOverlay();
        }
    };
    input.click();
}

function importGithub() {
    const repoUrl = prompt("Enter GitHub repository URL (e.g., https://github.com/user/repo):");
    if (!repoUrl) return;

    showImportOverlay();

    fetch('/api/import-github', {
        method: 'POST',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl, sessionId: currentSessionId || '' })
    })
    .then(response => {
        if (response.ok) {
            return response.json();
        } else {
            return response.json().then(error => { throw new Error(error.error); });
        }
    })
    .then(result => {
        loadFiles();
    })
    .catch(error => {
        console.error('Import error:', error);
        alert(`Import failed: ${error.message}`);
    })
    .finally(() => {
        hideImportOverlay();
    });
}

function exportArchive() {
    const link = document.createElement('a');
    link.href = `/api/export-archive?sessionId=${currentSessionId || ''}`;
    link.download = 'multicode-export.zip';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function renameFile(id) {
    const file = fileMap[id];
    if (!file) return;

    const newName = prompt("Enter new name:", file.name);
    if (!newName || newName.trim() === file.name) return;

    fetch(`/api/files/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), sessionId: currentSessionId })
    })
    .then(response => {
        if (response.ok) {
            loadFiles();
        } else {
            alert("Failed to rename file");
        }
    })
    .catch(error => {
        console.error('Rename error:', error);
        alert("Failed to rename file");
    });
}

function deleteFile(id) {
    const file = fileMap[id];
    const itemType = file && file.type === 'folder' ? 'folder' : 'file';
    const message = `Delete this ${itemType}?`;

    if (confirm(message)) {
        fetch(`/api/files/${id}`, { method: "DELETE" })
            .then(() => {
                if (currentFile?._id === id) {
                    currentFile = null;
                    editor.setValue("");
                    editorHeader.textContent = `${itemType.charAt(0).toUpperCase() + itemType.slice(1)} deleted`;
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

        // Append to the scroller element for correct positioning
        const scroller = editor.getScrollerElement();
        scroller.appendChild(container);

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

        const coords = editor.cursorCoords(adjustedPosition, 'local');
        const gutterWidth = editor.getGutterElement().offsetWidth;
        remoteCursors[userId].style.left = (coords.left + gutterWidth) + 'px';
        remoteCursors[userId].style.top = coords.top + 'px';
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
        const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'bmp', 'webp', 'ico'];
        const ext = currentFile.name.split('.').pop()?.toLowerCase() || '';
        const isImage = imageExtensions.includes(ext);
        if (isImage) {
            const img = imageViewer.querySelector('img');
            if (img) {
                img.src = `data:image/${ext === 'svg' ? 'svg+xml' : ext};base64,${data.patches}`;
            }
            lastContent[data.fileId] = data.patches;
            return;
        }
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

loadFiles();












