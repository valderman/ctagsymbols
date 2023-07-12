const path = require("path")
const vscode = require("vscode")
const eol = require("os").EOL
const cp = require("child_process")

exports.activate = () => {
    vscode.languages.registerWorkspaceSymbolProvider({
        provideWorkspaceSymbols: provideWorkspaceSymbols,
        resolveWorkspaceSymbol: resolveSymbolLocation
    })
    vscode.commands.registerCommand("ctagsymbols.regenerateTags", regenerateAllTags)
    vscode.workspace.onDidSaveTextDocument(autoRegenerateTags)
}
exports.deactivate = () => {}

const groupBy = (xs, f) =>
    xs.reduce(function(groups, x) {
        const key = f(x)
        groups[key] = groups[key] || []
        groups[key].push(x);
        return groups;
    }, {})

const uniqueEntries = entries => {
    const groups = groupBy(entries, e => `${e.location.uri.fsPath}:${e.name}`)
    return Object.values(groups).map(group => group[0])
}

const resolveNumber = symbolInfo => {
    const line = symbolInfo.target-1
    const pos = new vscode.Position(line, 0)
    return new vscode.Location(symbolInfo.location.uri, pos)
}

// Updates symbolInfo with the location of the first occurrence of its target pattern.
const resolveLineNumberForPattern = async symbolInfo => {
    const file = await vscode.workspace.fs.readFile(symbolInfo.location.uri)
    const fileContent = file.toString()
    const index = fileContent.indexOf(symbolInfo.target)
    if(index < 0) {
        return symbolInfo.location
    } else {
        const line = fileContent.substring(0, index).split(eol).length-1
        const pos = new vscode.Position(line, 0)
        return new vscode.Location(symbolInfo.location.uri, pos)
    }
}

// Does the given cache differ from the given file?
const needsUpdate = async (cache, tagsFile) => {
    if(!cache || cache.forFile.fsPath != tagsFile.fsPath) {
        console.log("Cache needs update: pointed to a new file.")
        return true
    }
    try {
        const stat = await vscode.workspace.fs.stat(tagsFile)
        if(stat.mtime > cache.timestamp) {
            console.log("Cache needs update: out of date.")
            return true
        }
    } catch (e) {
        // If the file doesn't exist, we only need to recache it if it previously *did* exist.
        return cache.entries.length != 0
    }
    return false
}

const tagLineRegex = /([^\t]+)\t([^\t]+)\t(.*)/

// Builds an in-memory representation of tagsFile.
const buildSymbolCache = async (tagsFile, rootDir, hideDuplicateTags) => {
    try {
        const data = (await vscode.workspace.fs.readFile(tagsFile)).toString()
        const entries = data.split(eol).reduce(parseSymbol.bind(null, rootDir), [])
        console.log(`Loaded tags from ${tagsFile.fsPath}`)
        const filteredEntries = hideDuplicateTags
            ? uniqueEntries(entries)
            : entries
        return new SymbolCache(tagsFile, filteredEntries)
    } catch (e) {
        console.log(`Unable to read tags from '${tagsFile.fsPath}'; providing no symbols.`)
        return new SymbolCache(tagsFile, [])
    }
}

// Parses line into a SymbolInformation and appends it to the end of the entries array.
const parseSymbol = (rootDir, entries, line) => {
    if(!line.startsWith("!_TAG_")) {
        const parts = line.match(tagLineRegex)
        if(parts && parts.length == 4) {
            const file = path.isAbsolute(parts[2])
                ? parts[2]
                : path.join(rootDir, parts[2])
            const loc = new vscode.Location(vscode.Uri.file(file), null)
            const entry = new vscode.SymbolInformation(parts[1], vscode.SymbolKind.Constant, "", loc)
            entry.target = toTargetAddress(parts[3])
            entries.push(entry)
        }
    }
    return entries
}

// Parses the given string into a target address.
// A target address is either a line number, or a pattern representing the text on the target line.
const toTargetAddress = s => {
    let matches
    try {
        switch(s[0]) {
        case '/':
            matches = s.match(/^\/\^(.+)\$\/\s*;?/)
            return matches ? matches[1] : s
        case '?':
            matches = s.match(/^\?(.+)\?\s*;?/)
            return matches ? matches[1] : s
        default:
            return Number(s)
        }
    } catch (e) {
        console.warn(`Invalid regular expression: '${s}'`)
    }
}

// Merges entries in the given list of symbol caches into a single list of entries,
// sorted by symbol name.
const mergeCacheEntries = symbolCaches => {
    let mergedSymbolCache = symbolCaches.flatMap(c => c.entries)
    mergedSymbolCache.sort((a, b) => {
        if(a.name < b.name) {
            return -1
        }
        if(a.name > b.name) {
            return 1
        }
        return 0
    })
    return mergedSymbolCache
}

// Returns a new in-memory representation of the given tags file, if the old one is out of date.
const rebuildIfNecessary = async (cache, folder, tagsFileName, hideDuplicateTags) => {
    const tagsFile = vscode.Uri.file(path.join(folder.uri.fsPath, tagsFileName))
    if(await needsUpdate(cache, tagsFile)) {
        return await buildSymbolCache(tagsFile, folder.uri.fsPath, hideDuplicateTags)
    }
}

class SymbolCache {
    constructor(forFile, entries) {
        this.forFile = forFile
        this.timestamp = Date.now()
        this.entries = entries
    }
}

class MergedSymbolCache {
    constructor() {
        this.symbolCaches = []
        this.entries = []
    }

    // Ensures that this symbol cache is coherent with the tags files backing it.
    async ensureCoherency(tagsFileName, hideDuplicateTags, folders) {
        const tasks = folders.map(async (folder, ix) =>
            await rebuildIfNecessary(this.symbolCaches[ix], folder, tagsFileName, hideDuplicateTags)
        )
        const anyUpdated = (await Promise.all(tasks)).reduce((anyUpdated, cache, ix) => {
            if(cache) {
                this.symbolCaches[ix] = cache
                return true
            }
            return anyUpdated
        }, false)
        if(anyUpdated) {
            this.entries = mergeCacheEntries(this.symbolCaches)
        }
    }
}

const mergedSymbolCache = new MergedSymbolCache()

const provideWorkspaceSymbols = async query => {
    // Read settings
    const config = vscode.workspace.getConfiguration("ctagsymbols")
    const minQueryLength = config.get("minQueryLength")
    if(query.length < minQueryLength) {
        return []
    }
    const folders = vscode.workspace.workspaceFolders
    const tagsFileName = config.get("tagsFileName")
    const hideDuplicateTags = config.get("hideDuplicateTags")
    const maxNumberOfSymbols = config.get("maxNumberOfSymbols")

    // Ensure we've got the latest tags
    await mergedSymbolCache.ensureCoherency(tagsFileName, hideDuplicateTags, folders)

    // Query the cached tag list
    const queryRegex = new RegExp(query, "i")
    const filteredEntries = mergedSymbolCache.entries
        .filter(entry => entry.name.match(queryRegex))
    return maxNumberOfSymbols
        ? filteredEntries.slice(0, maxNumberOfSymbols)
        : filteredEntries
}

// Updates symbolInfo with the location of the symbol.
const resolveSymbolLocation = async symbolInfo => {
    if(symbolInfo.location.range) {
        return symbolInfo
    }
    if(typeof symbolInfo.target === "number") {
        symbolInfo.location = resolveNumber(symbolInfo)
    } else {
        symbolInfo.location = await resolveLineNumberForPattern(symbolInfo)
    }
    delete symbolInfo.target
    return symbolInfo
}

// Regenerate tags files for all workspaces.
const regenerateAllTags = () => {
    const config = vscode.workspace.getConfiguration("ctagsymbols")
    const tagsFile = config.get("tagsFileName")
    const commandTemplate = config.get("regenerateCommand")
    vscode.workspace.workspaceFolders.forEach(folder =>
        regenerateTags(folder.uri.fsPath, tagsFile, commandTemplate)
    )
}

const wsFolderRegex = /\$\{workspaceFolder\}/
const tagsPathRegex = /\$\{tagsFile\}/
const fillInPaths = (template, folder, tagsPath) =>
    template.replaceAll(wsFolderRegex, folder).replaceAll(tagsPathRegex, tagsPath)

// Regenerate tags file for the given workspace folder and tags file, using the
// given command template.
const regenerateTags = (folder, tagsFile, commandTemplate) => {
    const tagsPath = path.join(folder, tagsFile)
    console.log(`Regenerating ${tagsPath}...`)
    const command = fillInPaths(commandTemplate, folder, tagsPath)
    cp.exec(command, err => {
        if(err) {
            console.error(`Unable to regenerate ${tagsPath}:\n${err.message}`)
            const message = commandTemplate.startsWith("ctags")
                ? "Unable to regenerate tags. Have you installed ctags?"
                : "Unable to regenerate tags. Check your \"Regenerate CTags\" command settings."
            vscode.window.showErrorMessage(message)
        }
    })
}

// Regenerate tags for the workspace folder in which the given document resides,
// if this features is enabled.
const autoRegenerateTags = textDocument => {
    const config = vscode.workspace.getConfiguration("ctagsymbols")
    if(config.get("regenerateOnSave")) {
        const tagsFile = config.get("tagsFileName")
        const commandTemplate = config.get("regenerateCommand")
        const workspace = vscode.workspace.workspaceFolders.find(ws =>
            textDocument.fileName.startsWith(ws.uri.fsPath)
        )
        if(workspace) {
            regenerateTags(workspace.uri.fsPath, tagsFile, commandTemplate)
        }
    }
}
