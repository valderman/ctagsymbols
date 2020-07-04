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

const tagsFormat = { numbers: "numbers", regex: "regex" }

class SymbolCache {
    constructor(forFile = null, entries = [], format = tagsFormat.numbers) {
        this.forFile = forFile
        this.timestamp = Date.now()
        this.entries = entries
        this.format = format
    }

    async resolve(symbolInfo) {
        if(symbolInfo.location.range) {
            return symbolInfo
        }
        switch(this.format) {
        case tagsFormat.numbers:
            symbolInfo.location = this.resolveNumber(symbolInfo)
            break;
        case tagsFormat.regex:
            symbolInfo.location = await this.resolveRegex(symbolInfo)
            break;
        }
        return symbolInfo
    }

    resolveNumber(symbolInfo) {
        const line = Number(symbolInfo.target)-1
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

const ensureSymbolCacheCoherency = async (tagsFile, projectRoot) => {
    if(await needsUpdate(symbolCache, tagsFile)) {
        symbolCache = await updateSymbolCache(tagsFile, projectRoot)
    }
}

const tagLineRegex = /([^\t]+)\t([^\t]+)\t(.*)/
const updateSymbolCache = async (tagsFile, projectRoot) => {
    try {
        const data = (await vscode.workspace.fs.readFile(tagsFile)).toString()
        const state = {entries: [], format: tagsFormat.numbers}
        const entries = data.split(eol).reduce(parseSymbol.bind(null, projectRoot), state)
        console.log(`Loaded tags (format: ${entries.format}) from ${tagsFile.fsPath}`)
        return new SymbolCache(tagsFile, entries.entries, state.format)
    } catch (e) {
        console.log(`Unable to read tags from '${tagsFile}'; providing no symbols.`)
        return new SymbolCache(tagsFile, [])
    }
}

const parseSymbol = (projectRoot, state, line) => {
    if(line.startsWith("!_TAG_")) {
        const parts = line.split("\t")
        if(parts[0] == "!_TAG_FILE_FORMAT" && parts[1] == "2") {
            state.format = tagsFormat.regex
        }
    } else {
        const parts = line.match(tagLineRegex)
        if(parts && parts.length == 4) {
            const file = path.join(projectRoot, parts[2])
            const loc = new vscode.Location(vscode.Uri.file(file), null)
            const entry = new vscode.SymbolInformation(parts[1], vscode.SymbolKind.Constant, "", loc)
            entry.target = toTargetLine(parts[3])
            state.entries.push(entry)
        }
    }
    return state
}

const toTargetLine = s => {
    const matches = s.match(/\/\^([^/]+)\$\//)
    return matches ? matches[1] : s
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
