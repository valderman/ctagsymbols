# CTags Symbol Search
A zero-config workspace symbol provider using ctags.

## Features
* Search for tags using the standard "Go to Symbol in Workspace" dialog
* Multi-root workspace support
* Cross-platform
* Regenerate tags from within VSCode using the `Regenerate CTags` command
* Automatically regenerate tags on file save (disabled by default)
* Works out of the box without having to touch any configuration

This extension is intended to be a complement to your existing language tooling, or to provide a minimal level of
code navigation support for languages which don't have any native VSCode integrations.
I originally wrote it for use with the [Simple GHC Integration](https://marketplace.visualstudio.com/items?itemName=dramforever.vscode-ghc-simple).


## Requirements
A program to generate the `ctags` file for your language.
For most language this would be [Exuberant Ctags](http://ctags.sourceforge.net),
for Haskell it would be [hasktags](https://hackage.haskell.org/package/hasktags), etc.


## Setup
If you have [Exuberant Ctags](http://ctags.sourceforge.net) installed and are
using a language it supports, the default settings have got you covered.
Just run the `Regenerate CTags` command whenever you need to update your tags, and you're good to go.

You can also let this extension regenerate your tags files automatically whenever you save a source file.
This will regenerate the tags file for the workspace in which the saved file resides.
This feature is disabled by default due to performance concerns with huge code bases. It's recommended
that you enable this feature on a per-workspace basis, rather than for all your projects.

If you're using Haskell, you will want to change the `Regenerate Command` to
`hasktags -f "${tagsFile}" -cxR "${workspaceFolder}"`, to let `hasktags` handle
tag regeneration instead of `ctags`.


## Extension Settings
* `ctagsymbols.tagsFile`: path to the ctags file to read symbols from, relative to the workspace root.
* `ctagsymbols.hideDuplicateTags`: when there are multiple tags with the same name in the same source file, hide all but the first one.
  Changes to this setting take effect the next time the tags file is updated or the extension is reloaded.
* `ctagsymbols.maxNumberOfSymbols`: never display more than this many symbols, regardless of the number of matches.
* `ctagsymbols.minQueryLength`: don't process symbol queries shorter than this. May improve performance for large code bases since it avoids listing every single symbol in the entire project.
* `ctagsymbols.regenerateCommand`: command to use for regenerating tags files when `Regenerate CTags` is invoked.
* `ctagsymbols.regenerateOnSave`: should the `Regenerate CTags` command be run whenever a file is saved?


## Known Issues
* Ignores extended tag information; reports all symbols as constants.
* Only supports one tags file per workspace root.
* Ignores concatenated Ex commands in tag files.
* Treats regex Ex commands as plain string matches.
* Does not support regenerating tags on save for only some file types; it's all or nothing.
