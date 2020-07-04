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

class SymbolCache {
    constructor(forFile = null, entries = []) {
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
        const matches = fileContent.match(symbolInfo.target)
        if(!matches) {
            return symbolInfo.location
        } else {
            const line = fileContent.substring(0, matches.index).split(eol).length-1
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

const ensureSymbolCacheCoherency = async (tagsFile, projectRoot) => {
    if(await needsUpdate(symbolCache, tagsFile)) {
        symbolCache = await updateSymbolCache(tagsFile, projectRoot)
    }
}

const tagLineRegex = /([^\t]+)\t([^\t]+)\t(.*)/
const updateSymbolCache = async (tagsFile, projectRoot) => {
    try {
        const data = (await vscode.workspace.fs.readFile(tagsFile)).toString()
        const entries = data.split(eol).reduce(parseSymbol.bind(null, projectRoot), [])
        console.log(`Loaded tags from ${tagsFile.fsPath}`)
        return new SymbolCache(tagsFile, entries)
    } catch (e) {
        console.log(`Unable to read tags from '${tagsFile}'; providing no symbols.`)
        return new SymbolCache(tagsFile, [])
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
            matches = s.match(/^\/(.+)\/\s*;?/)
            return new RegExp(matches ? matches[1] : s, "m")
        case '?':
            matches = s.match(/^\?(.+)\?\s*;?/)
            return new RegExp(matches ? matches[1] : s, "m")
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
    if(query.length < minQueryLength) {
        return []
    }
    const projectRoot = vscode.workspace.workspaceFolders[0].uri.fsPath
    const tagsFile = vscode.Uri.file(path.join(projectRoot, tagsFileName))
    const queryRegex = new RegExp(query, "i")
    await ensureSymbolCacheCoherency(tagsFile, projectRoot)
    return symbolCache.entries.filter(entry => entry.name.match(queryRegex))
}

const resolveWorkspaceSymbol = async symbol => {
    return await symbolCache.resolve(symbol)
}
