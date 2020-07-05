# CTags Workspace Symbol Provider
A bare-bones workspace symbol provider using ctags.

## Features
* Search for tags using the standard "Go to Symbol in Workspace" dialog.
* Multi-root workspace support.

This extension is intended to be a complement to your existing language tooling, or to provide a minimal level of
code navigation support for languages which don't have any native VSCode integrations.
I originally wrote it for use with the [Simple GHC Integration](https://marketplace.visualstudio.com/items?itemName=dramforever.vscode-ghc-simple).


## Setup
ctagsymbols requires a tags file to work. This may be generated using [Exuberant Ctags](http://ctags.sourceforge.net), hasktags (for Haskell), etc.
By default, ctagsymbols looks for tags in `<workspace root>/.tags`.

It is highly recommended to use an extension such as [Run On Save](https://marketplace.visualstudio.com/items?itemName=emeraldwalk.RunOnSave)
to regenerate your tags whenever you make changes to your source.


## Extension Settings
* `ctagsymbols.tagsFile`: path to the ctags file to read symbols from, relative to the workspace root.
* `ctagsymbols.hideDuplicateTags`: when there are multiple tags with the same name in the same source file, hide all but the first one.
  Changes to this setting take effect the next time the tags file is updated or the extension is reloaded.
* `ctagsymbols.maxNumberOfSymbols`: never display more than this many symbols, regardless of the number of matches.
* `ctagsymbols.minQueryLength`: don't process symbol queries shorter than this. May improve performance for large code bases since it avoids listing every single symbol in the entire project.


## Known Issues
* Ignores extended tag information; reports all symbols as constants.
* Only supports one tags file per workspace root.
* Ignores concatenated Ex commands in tag files.
* Treats regex Ex commands as plain string matches.
