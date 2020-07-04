const path = require('path')
const vscode = require('vscode')
const fs = require('fs')

exports.activate = () => {
    vscode.languages.registerWorkspaceSymbolProvider(symbolProvider)
}
exports.deactivate = () => {}

let symbolCache = null

const ensureSymbolCacheCoherency = (tagsFile, projectRoot) => {
    if(!symbolCache || fs.statSync(tagsFile).mtime > symbolCache.timestamp) {
        symbolCache = updateSymbolCache(tagsFile, projectRoot)
    }
}

const tagLineRegex = /([^\t]+)\t([^\t]+)\t(.*)/
const updateSymbolCache = (tagsFile, projectRoot) => {
    try {
        const data = fs.readFileSync(tagsFile)
        const entries = data.toString()
            .split("\n")
            .map(ln => {
                if(ln.startsWith('!_TAG_')) {
                    return null
                }
                const parts = ln.match(tagLineRegex)
                return (parts && parts.length == 4)
                    ? toSymbolInformation(parts[1], parts[2], parts[3], projectRoot)
                    : null
            })
            .filter(entry => entry)
        return {
            timestamp: Date.now(),
            entries: entries
        }
    } catch (e) {
        console.log(e)
        console.log("Unable to open tags file; assuming no symbols.")
        return {
            timestamp: Date.now(),
            entries: []
        }
    }
}

const toSymbolInformation = (symbol, file, address, projectRoot) => {
    const line = Number(address.match(/.*\sline:(\d+)\s.*/)[1])
    const range = new vscode.Range(line, 0, line+1, 1)
    const loc = new vscode.Location(vscode.Uri.file(path.join(projectRoot, file)), range)
    return new vscode.SymbolInformation(symbol, vscode.SymbolKind.Constant, "", loc)
}

const provideWorkspaceSymbols = query => {
    const projectRoot = vscode.workspace.workspaceFolders[0].uri.fsPath
    const tagsFile = path.join(projectRoot, ".tags")
    const queryRegex = new RegExp(query, "i")
    ensureSymbolCacheCoherency(tagsFile, projectRoot)
    return symbolCache.entries.filter(entry => entry.name.match(queryRegex))
}

const symbolProvider = {
    provideWorkspaceSymbols: provideWorkspaceSymbols
}
