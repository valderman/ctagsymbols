const path = require("path")
const vscode = require("vscode")
const fs = require("fs")

exports.activate = () => {
    vscode.languages.registerWorkspaceSymbolProvider({
        provideWorkspaceSymbols: provideWorkspaceSymbols
    })
}
exports.deactivate = () => {}

class SymbolCache {
    constructor(forFile = null, entries = []) {
        this.forFile = forFile
        this.timestamp = Date.now()
        this.entries = entries
    }
}

let symbolCache = new SymbolCache()

const needsUpdate = async (cache, tagsFile) => {
    if(cache.forFile != tagsFile) {
        console.log("Cache needs update: pointed to a new file.")
        return true
    }
    const mtime = await new Promise(resolve => {
        fs.stat(tagsFile, (err, data) => resolve(data.mtime.getTime()))
    })
    if(mtime > cache.timestamp) {
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
    const data = await new Promise(resolve => {
        fs.readFile(tagsFile, (err, data) => {
            if(err) {
                console.log(`Unable to read tags from '${tagsFile}'; providing no symbols.`)
                resolve("")
            }
            resolve(data.toString())
        })
    })
    const entries = data.split("\n").reduce(parseSymbol.bind(null, projectRoot), [])
    return new SymbolCache(tagsFile, entries)
}

const parseSymbol = (projectRoot, entries, line) => {
    if(!line.startsWith("!_TAG_")) {
        const parts = line.match(tagLineRegex)
        if(parts && parts.length == 4) {
            const entry = toSymbolInformation(parts[1], parts[2], parts[3], projectRoot)
            entries.push(entry)
        }
    }
    return entries
}

const toSymbolInformation = (symbol, file, address, projectRoot) => {
    const line = Number(address.match(/.*\sline:(\d+)\s.*/)[1])
    const range = new vscode.Range(line, 0, line+1, 1)
    const loc = new vscode.Location(vscode.Uri.file(path.join(projectRoot, file)), range)
    return new vscode.SymbolInformation(symbol, vscode.SymbolKind.Constant, "", loc)
}

const provideWorkspaceSymbols = async query => {
    const config = vscode.workspace.getConfiguration("ctagsymbols")
    const tagsFileName = config.get("tagsFileName")
    const minQueryLength = config.get("minQueryLength")
    if(query.length < minQueryLength) {
        return []
    }
    const projectRoot = vscode.workspace.workspaceFolders[0].uri.fsPath
    const tagsFile = path.join(projectRoot, tagsFileName)
    const queryRegex = new RegExp(query, "i")
    await ensureSymbolCacheCoherency(tagsFile, projectRoot)
    return symbolCache.entries.filter(entry => entry.name.match(queryRegex))
}
