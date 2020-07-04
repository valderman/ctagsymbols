const path = require("path")
const vscode = require("vscode")
const eol = require("os").EOL

exports.activate = () => {
    vscode.languages.registerWorkspaceSymbolProvider({
        provideWorkspaceSymbols: provideWorkspaceSymbols,
        resolveWorkspaceSymbol: resolveWorkspaceSymbol
    })
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

class SymbolCache {
    constructor(forFile = null, entries = [], hideDuplicateTags = false) {
        this.forFile = forFile
        this.timestamp = Date.now()
        this.entries = entries
    }

    async resolve(symbolInfo) {
        if(symbolInfo.location.range) {
            return symbolInfo
        }
        if(typeof symbolInfo.target === "number") {
            symbolInfo.location = this.resolveNumber(symbolInfo)
        } else {
            symbolInfo.location = await this.resolveRegex(symbolInfo)
        }
        delete symbolInfo.target
        return symbolInfo
    }

    resolveNumber(symbolInfo) {
        const line = symbolInfo.target-1
        const pos = new vscode.Position(line, 0)
        return new vscode.Location(symbolInfo.location.uri, pos)
    }

    async resolveRegex(symbolInfo) {
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
}

let symbolCache = new SymbolCache()

const needsUpdate = async (cache, tagsFile) => {
    if(!cache.forFile || cache.forFile.fsPath != tagsFile.fsPath) {
        console.log("Cache needs update: pointed to a new file.")
        return true
    }
    const stat = await vscode.workspace.fs.stat(tagsFile)
    if(stat.mtime > cache.timestamp) {
        console.log("Cache needs update: out of date.")
        return true
    }
    return false
}

const ensureSymbolCacheCoherency = async (tagsFile, projectRoot, hideDuplicateTags) => {
    if(await needsUpdate(symbolCache, tagsFile)) {
        symbolCache = await updateSymbolCache(tagsFile, projectRoot, hideDuplicateTags)
    }
}

const tagLineRegex = /([^\t]+)\t([^\t]+)\t(.*)/
const updateSymbolCache = async (tagsFile, projectRoot) => {
    try {
        const data = (await vscode.workspace.fs.readFile(tagsFile)).toString()
        const entries = data.split(eol).reduce(parseSymbol.bind(null, projectRoot), [])
        console.log(`Loaded tags from ${tagsFile.fsPath}`)
        const filteredEntries = uniqueEntries
            ? uniqueEntries(entries)
            : entries
        return new SymbolCache(tagsFile, filteredEntries)
    } catch (e) {
        console.log(e)
        console.log(`Unable to read tags from '${tagsFile.fsPath}'; providing no symbols.`)
        return new SymbolCache(tagsFile, [], uniqueEntries)
    }
}

const parseSymbol = (projectRoot, entries, line) => {
    if(!line.startsWith("!_TAG_")) {
        const parts = line.match(tagLineRegex)
        if(parts && parts.length == 4) {
            const file = path.join(projectRoot, parts[2])
            const loc = new vscode.Location(vscode.Uri.file(file), null)
            const entry = new vscode.SymbolInformation(parts[1], vscode.SymbolKind.Constant, "", loc)
            entry.target = toTargetAddress(parts[3])
            entries.push(entry)
        }
    }
    return entries
}

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

const provideWorkspaceSymbols = async query => {
    const config = vscode.workspace.getConfiguration("ctagsymbols")
    const tagsFileName = config.get("tagsFileName")
    const minQueryLength = config.get("minQueryLength")
    const hideDuplicateTags = config.get("hideDuplicateTags")
    const maxNumberOfSymbols = config.get("maxNumberOfSymbols")
    if(query.length < minQueryLength) {
        return []
    }
    const projectRoot = vscode.workspace.workspaceFolders[0].uri.fsPath
    const tagsFile = vscode.Uri.file(path.join(projectRoot, tagsFileName))
    const queryRegex = new RegExp(query, "i")
    await ensureSymbolCacheCoherency(tagsFile, projectRoot, hideDuplicateTags)
    const filteredEntries = symbolCache.entries.filter(entry => entry.name.match(queryRegex))
    return maxNumberOfSymbols
        ? filteredEntries.slice(0, maxNumberOfSymbols)
        : filteredEntries
}

const resolveWorkspaceSymbol = async symbol => {
    return await symbolCache.resolve(symbol)
}
